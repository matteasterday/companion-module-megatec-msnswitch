/**
 * HTTP transport for the MSNSwitch2 (UIS-622B) network power switch.
 *
 * Two API generations are supported, selected by `apiVersion`:
 *
 *  - `json`   Modern JSON API (firmware >= 3207, 2023+). Every request must carry
 *             the device's web-UI credentials as a form-encoded body (per vendor
 *             tech note MSNTN001 the examples are curl --data "user=..&password=..",
 *             i.e. a POST), and the caller's IP must be on the device's API
 *             whitelist. Endpoints:
 *               POST /api/status
 *               POST /api/control?target=<TAR>&action=<ACT>
 *               POST /api/heartbeat
 *
 *  - `legacy` Older CGI/XML API (firmware A624-era, 2020-2022).
 *               Control:   GET /cgi-bin/control2.cgi?user=&passwd=&target=&control=
 *               Status:    GET /xml/outlet_status.xml with a session cookie obtained
 *                          from POST /goform/login (re-logs-in automatically).
 *               Heartbeat: GET /cgi-bin/heartbeat.cgi?user=&passwd=
 *
 * Uses node:http / node:https directly (not fetch) so that HTTPS requests to the
 * device's self-signed certificate can disable TLS verification.
 */

import * as http from 'node:http'
import * as https from 'node:https'
import * as zlib from 'node:zlib'
import { URLSearchParams } from 'node:url'
import type {
	ConnectionState,
	ControlAction,
	DeviceState,
	JsonControlResponse,
	JsonHeartbeatResponse,
	JsonStatusResponse,
	OutletState,
	OutletTarget,
} from './types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ApiVersion = 'json' | 'legacy'
export type Protocol = 'http' | 'https'

export interface MsnClientOptions {
	host: string
	protocol: Protocol
	apiVersion: ApiVersion
	username: string
	password: string
	timeoutMs: number
	log: (level: LogLevel, message: string) => void
}

/** Thrown when an HTTP request fails, times out, or the response cannot be parsed. */
export class MsnTransportError extends Error {}

/** Name of the legacy session cookie set by /goform/login. */
const LEGACY_COOKIE_NAME = 'WQKJhuEcnAVA3t7WE+ug6A'

const LEGACY_TARGET: Record<OutletTarget, number> = {
	uis: 0,
	outlet1: 1,
	outlet2: 2,
	outlet_all: 3,
}

/** control codes: 0=Off, 1=On, 3=Reset (2=Toggle is unreliable across firmware, avoided). */
const LEGACY_CONTROL: Record<ControlAction, number> = {
	off: 0,
	on: 1,
	reset: 3,
}

interface HttpResult {
	status: number
	body: string
	headers: http.IncomingHttpHeaders
}

export class MsnClient {
	private legacyCookie: string | null = null

	constructor(private opts: MsnClientOptions) {}

	// --------------------------------------------------------------- public API

	/** Fetch and normalize the current device state. */
	async getStatus(): Promise<DeviceState> {
		return this.opts.apiVersion === 'json' ? this.getStatusJson() : this.getStatusLegacy()
	}

	/** Send a control command. Does not return the resulting state — poll to refresh. */
	async control(target: OutletTarget, action: ControlAction): Promise<void> {
		if (this.opts.apiVersion === 'json') {
			await this.controlJson(target, action)
		} else {
			await this.controlLegacy(target, action)
		}
	}

	/** Ping the device's heartbeat endpoint; returns the reported timestamp/body. */
	async heartbeat(): Promise<string> {
		return this.opts.apiVersion === 'json' ? this.heartbeatJson() : this.heartbeatLegacy()
	}

	// --------------------------------------------------------------- JSON API (firmware 3207+)

	/**
	 * The JSON API rejects bare GETs (HTTP 400): every request must POST the web-UI
	 * credentials as a form body, and the vendor doc marks the Accept headers required.
	 */
	private async requestJsonApi(path: string): Promise<HttpResult> {
		const body = `user=${encodeURIComponent(this.opts.username)}&password=${encodeURIComponent(this.opts.password)}`
		return this.request(path, {
			method: 'POST',
			body,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: '*/*',
				'Accept-Encoding': 'gzip, deflate',
			},
		})
	}

	private async getStatusJson(): Promise<DeviceState> {
		const res = await this.requestJsonApi('/api/status')
		this.assertOk(res)
		let parsed: JsonStatusResponse
		try {
			parsed = JSON.parse(res.body) as JsonStatusResponse
		} catch {
			throw new MsnTransportError('Invalid JSON received from device')
		}
		return this.normalizeJsonStatus(parsed)
	}

	private normalizeJsonStatus(parsed: JsonStatusResponse): DeviceState {
		const raw = parsed.status?.outlet ?? []
		const outlets: [OutletState, OutletState] = [
			{
				name: raw[0]?.name || 'Outlet 1',
				on: !!raw[0]?.status,
				resetOnly: !!raw[0]?.reset_only,
			},
			{
				name: raw[1]?.name || 'Outlet 2',
				on: !!raw[1]?.status,
				resetOnly: !!raw[1]?.reset_only,
			},
		]
		const connections: ConnectionState[] = (parsed.connections ?? []).map((c) => ({
			assign: c.assign ?? 'NONE',
			label: c.label ?? '',
			host: c.host ?? '',
			ip: c.ip ?? '',
			resp: c.resp ?? 0,
			timeout: c.timeout ?? 0,
			lost: c.lost ?? 0,
		}))
		return { reachable: true, outlets, uisOn: !!parsed.status?.uis, connections }
	}

	private async controlJson(target: OutletTarget, action: ControlAction): Promise<void> {
		const res = await this.requestJsonApi(`/api/control?target=${target}&action=${action}`)
		this.assertOk(res)
		try {
			const parsed = JSON.parse(res.body) as JsonControlResponse
			this.opts.log('debug', `control response: outlet=${JSON.stringify(parsed.outlet)} uis=${parsed.uis}`)
		} catch {
			// Response body isn't required for correctness — the module refreshes via polling.
		}
	}

	private async heartbeatJson(): Promise<string> {
		const res = await this.requestJsonApi('/api/heartbeat')
		this.assertOk(res)
		try {
			const parsed = JSON.parse(res.body) as JsonHeartbeatResponse
			return parsed.heartbeat ?? res.body.trim()
		} catch {
			return res.body.trim()
		}
	}

	// --------------------------------------------------------------- Legacy CGI/XML API

	private async getStatusLegacy(): Promise<DeviceState> {
		if (!this.legacyCookie) await this.legacyLogin()
		let res = await this.request('/xml/outlet_status.xml', { headers: this.legacyCookieHeader() })
		if (!this.looksLikeStatusXml(res.body)) {
			// Session likely expired (or was never established) — log in and retry once.
			await this.legacyLogin()
			res = await this.request('/xml/outlet_status.xml', { headers: this.legacyCookieHeader() })
		}
		this.assertOk(res)
		if (!this.looksLikeStatusXml(res.body)) {
			throw new MsnTransportError('Unexpected response from device (login failed?)')
		}
		return this.normalizeLegacyStatus(res.body)
	}

	private looksLikeStatusXml(body: string): boolean {
		return /<(outlet_status|site_ip|uis_fun)>/i.test(body)
	}

	private legacyCookieHeader(): Record<string, string> {
		return this.legacyCookie ? { Cookie: `${LEGACY_COOKIE_NAME}=${this.legacyCookie}` } : {}
	}

	private async legacyLogin(): Promise<void> {
		const body = `user=${encodeURIComponent(this.opts.username)}&password=${encodeURIComponent(this.opts.password)}`
		const res = await this.request('/goform/login', {
			method: 'POST',
			body,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		})
		this.assertOk(res)
		const cookieLines: string[] = res.headers['set-cookie'] ?? []
		const escapedName = LEGACY_COOKIE_NAME.replace(/\+/g, '\\+')
		const cookieLine = cookieLines.find((c) => new RegExp(escapedName).test(c))
		const match = cookieLine?.match(new RegExp(`${escapedName}=([^;]+)`))
		if (!match) {
			throw new MsnTransportError('Login failed — check the user name and password')
		}
		this.legacyCookie = match[1]
		this.opts.log('debug', 'Legacy login successful')
	}

	/** Parse the (per-outlet or combined) status XML into normalized device state. */
	private normalizeLegacyStatus(xml: string): DeviceState {
		const outletStatusRaw = extractAllTags(xml, 'outlet_status')
		const resetOnlyRaw = extractAllTags(xml, 'reset_only')
		const uisFunRaw = extractTag(xml, 'uis_fun')

		const outletOn =
			outletStatusRaw.length >= 2 ? outletStatusRaw.map((v) => v === '1') : parseBoolField(outletStatusRaw[0])
		const resetOnly = resetOnlyRaw.length >= 2 ? resetOnlyRaw.map((v) => v === '1') : parseBoolField(resetOnlyRaw[0])

		const outlets: [OutletState, OutletState] = [
			{ name: 'Outlet 1', on: outletOn[0] ?? false, resetOnly: resetOnly[0] ?? false },
			{ name: 'Outlet 2', on: outletOn[1] ?? false, resetOnly: resetOnly[1] ?? false },
		]

		// Legacy firmware packs the per-site arrays as comma-separated lists inside single
		// tags (e.g. <site_ip>1.2.3.4,5.6.7.8,null,null</site_ip>); unused slots are "null"
		// with -1 sentinels in the numeric fields.
		const siteIp = extractList(xml, 'site_ip')
		const siteLabel = extractList(xml, 'site_label')
		const connectStatus = extractList(xml, 'connect_status')
		const siteLost = extractList(xml, 'site_lost')
		const assignRaw = extractList(xml, 'assign')

		const connections: ConnectionState[] = []
		siteIp.forEach((ip, i) => {
			if (!ip || ip.toLowerCase() === 'null') return
			connections.push({
				assign: assignLabel(Number(assignRaw[i] ?? -1)),
				label: siteLabel[i] ?? '',
				host: '',
				ip,
				resp: nonNegative(connectStatus[i]),
				timeout: 0,
				lost: nonNegative(siteLost[i]),
			})
		})

		return { reachable: true, outlets, uisOn: uisFunRaw === '1', connections }
	}

	private async controlLegacy(target: OutletTarget, action: ControlAction): Promise<void> {
		const qs = new URLSearchParams({
			user: this.opts.username,
			passwd: this.opts.password,
			target: String(LEGACY_TARGET[target]),
			control: String(LEGACY_CONTROL[action]),
		})
		const res = await this.request(`/cgi-bin/control2.cgi?${qs.toString()}`)
		this.assertOk(res)
		this.opts.log('debug', `control2.cgi response: ${res.body.trim()}`)
	}

	private async heartbeatLegacy(): Promise<string> {
		const qs = new URLSearchParams({ user: this.opts.username, passwd: this.opts.password })
		const res = await this.request(`/cgi-bin/heartbeat.cgi?${qs.toString()}`)
		this.assertOk(res)
		return res.body.trim()
	}

	// --------------------------------------------------------------- raw HTTP

	/**
	 * Normalize the configured host into hostname + port. Tolerates pasted URLs
	 * ("http://192.168.0.10/"), "host:port" (a port-forwarded setup may expose the
	 * device off 80/443), and IPv6 literals ("::1" or "[::1]:8080").
	 */
	private parseHost(): { hostname: string; port: number } {
		const defaultPort = this.opts.protocol === 'https' ? 443 : 80
		let host = this.opts.host.trim()
		host = host.replace(/^https?:\/\//i, '')
		host = host.replace(/\/.*$/, '')
		const bracketed = host.match(/^\[([^\]]+)\](?::(\d+))?$/)
		if (bracketed) {
			return { hostname: bracketed[1], port: bracketed[2] ? Number(bracketed[2]) : defaultPort }
		}
		const colons = host.split(':').length - 1
		if (colons === 1) {
			const [hostname, portRaw] = host.split(':')
			return { hostname, port: Number(portRaw) || defaultPort }
		}
		// 0 colons (plain host) or 2+ colons (bare IPv6 literal, no port).
		return { hostname: host, port: defaultPort }
	}

	private assertOk(res: HttpResult): void {
		if (res.status < 200 || res.status >= 300) {
			if (this.opts.apiVersion === 'json' && (res.status === 400 || res.status === 401 || res.status === 403)) {
				throw new MsnTransportError(
					`HTTP ${res.status} — the device refused the request. The JSON API needs the device's web ` +
						`user name and password (set them in this connection's config), this computer's IP address on ` +
						`the device's API whitelist, and HTTP control enabled (device web UI → Network Service).`,
				)
			}
			throw new MsnTransportError(`HTTP ${res.status}`)
		}
	}

	private async request(
		path: string,
		options: { method?: string; body?: string; headers?: Record<string, string> } = {},
	): Promise<HttpResult> {
		return new Promise((resolve, reject) => {
			const isHttps = this.opts.protocol === 'https'
			const { hostname, port } = this.parseHost()
			const headers: Record<string, string> = { ...(options.headers ?? {}) }
			if (options.body !== undefined) {
				headers['Content-Length'] = String(Buffer.byteLength(options.body))
			}

			const onResponse = (res: http.IncomingMessage): void => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () => {
					try {
						const body = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
						resolve({ status: res.statusCode ?? 0, body, headers: res.headers })
					} catch {
						reject(new MsnTransportError('Failed to decompress the device response'))
					}
				})
				res.on('error', (e) => reject(new MsnTransportError(e.message)))
			}

			// insecureHTTPParser: the device firmware terminates response header lines with a
			// bare LF instead of CRLF, which Node's strict parser rejects ("missing expected
			// CR after header value").
			const req = isHttps
				? https.request(
						{
							host: hostname,
							port,
							path,
							method: options.method ?? 'GET',
							headers,
							timeout: this.opts.timeoutMs,
							rejectUnauthorized: false,
							insecureHTTPParser: true,
						},
						onResponse,
					)
				: http.request(
						{
							host: hostname,
							port,
							path,
							method: options.method ?? 'GET',
							headers,
							timeout: this.opts.timeoutMs,
							insecureHTTPParser: true,
						},
						onResponse,
					)

			req.on('timeout', () => {
				req.destroy()
				reject(new MsnTransportError('Request timed out'))
			})
			req.on('error', (e) => reject(new MsnTransportError(e.message)))
			if (options.body !== undefined) req.write(options.body)
			req.end()
		})
	}
}

// ------------------------------------------------------------------- helpers

/** Decode a response body that may be compressed (we advertise Accept-Encoding: gzip, deflate). */
function decodeBody(raw: Buffer, contentEncoding: string | undefined): string {
	const encoding = (contentEncoding ?? '').trim().toLowerCase()
	if (encoding === 'gzip') return zlib.gunzipSync(raw).toString('utf8')
	if (encoding === 'deflate') {
		try {
			return zlib.inflateSync(raw).toString('utf8')
		} catch {
			// Some embedded servers send raw deflate streams without the zlib wrapper.
			return zlib.inflateRawSync(raw).toString('utf8')
		}
	}
	return raw.toString('utf8')
}

/** Map the legacy `assign` code (0-3) onto the JSON API's assign labels. */
function assignLabel(code: number): ConnectionState['assign'] {
	switch (code) {
		case 1:
			return 'OUTLET1'
		case 2:
			return 'OUTLET2'
		case 3:
			return 'BOTH'
		default:
			return 'NONE'
	}
}

/**
 * Defensively parse a boolean-ish status field that may be a single "0"/"1", two packed
 * digits ("01"), or a comma-separated list ("0,1") depending on firmware.
 */
function parseBoolField(raw: string | undefined): boolean[] {
	if (!raw) return []
	const cleaned = raw.trim()
	if (cleaned.includes(',')) {
		return cleaned.split(',').map((s) => s.trim() === '1')
	}
	if (cleaned.length >= 2 && /^[01]+$/.test(cleaned)) {
		return cleaned.split('').map((c) => c === '1')
	}
	return [cleaned === '1']
}

/** Parse a numeric site field, mapping missing / non-numeric / negative sentinels (-1 = unused) to 0. */
function nonNegative(raw: string | undefined): number {
	const n = Number(raw)
	return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Extract the text of the first `<tag>...</tag>` occurrence. */
function extractTag(xml: string, tag: string): string | undefined {
	const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
	return m ? m[1].trim() : undefined
}

/** Extract the text of every `<tag>...</tag>` occurrence, in document order. */
function extractAllTags(xml: string, tag: string): string[] {
	const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gi')
	const out: string[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(xml))) out.push(m[1].trim())
	return out
}

/**
 * Extract tag values as a flat list, splitting comma-separated contents — legacy firmware
 * packs per-site arrays into a single tag ("a,b,c"), but repeated tags are tolerated too.
 */
function extractList(xml: string, tag: string): string[] {
	return extractAllTags(xml, tag).flatMap((v) => v.split(',').map((s) => s.trim()))
}
