/**
 * HTTP transport for the MSNSwitch2 (UIS-622B) network power switch.
 *
 * Two API generations are supported, selected by `apiVersion`:
 *
 *  - `json`   Modern JSON API (firmware >= 3207, 2023+). No authentication —
 *             the device relies on IP whitelisting. Endpoints:
 *               GET /api/status
 *               GET /api/control?target=<TAR>&action=<ACT>
 *               GET /api/heartbeat
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

	update(opts: MsnClientOptions): void {
		this.opts = opts
		this.legacyCookie = null
	}

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

	private async getStatusJson(): Promise<DeviceState> {
		const res = await this.request('/api/status')
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
		const res = await this.request(`/api/control?target=${target}&action=${action}`)
		this.assertOk(res)
		try {
			const parsed = JSON.parse(res.body) as JsonControlResponse
			this.opts.log('debug', `control response: outlet=${JSON.stringify(parsed.outlet)} uis=${parsed.uis}`)
		} catch {
			// Response body isn't required for correctness — the module refreshes via polling.
		}
	}

	private async heartbeatJson(): Promise<string> {
		const res = await this.request('/api/heartbeat')
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
		const assignRaw = extractAllTags(xml, 'assign')
		const siteIp = extractAllTags(xml, 'site_ip')
		const connectStatus = extractAllTags(xml, 'connect_status')
		const siteLost = extractAllTags(xml, 'site_lost')
		const uisFunRaw = extractTag(xml, 'uis_fun')

		const outletOn =
			outletStatusRaw.length >= 2 ? outletStatusRaw.map((v) => v === '1') : parseBoolField(outletStatusRaw[0])
		const resetOnly = resetOnlyRaw.length >= 2 ? resetOnlyRaw.map((v) => v === '1') : parseBoolField(resetOnlyRaw[0])

		const outlets: [OutletState, OutletState] = [
			{ name: 'Outlet 1', on: outletOn[0] ?? false, resetOnly: resetOnly[0] ?? false },
			{ name: 'Outlet 2', on: outletOn[1] ?? false, resetOnly: resetOnly[1] ?? false },
		]

		const connections: ConnectionState[] = siteIp.map((ip, i) => ({
			assign: assignLabel(Number(assignRaw[i] ?? -1)),
			label: '',
			host: '',
			ip,
			resp: Number(connectStatus[i] ?? 0) || 0,
			timeout: 0,
			lost: Number(siteLost[i] ?? 0) || 0,
		}))

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

	private assertOk(res: HttpResult): void {
		if (res.status < 200 || res.status >= 300) {
			if (this.opts.apiVersion === 'json' && (res.status === 401 || res.status === 403)) {
				throw new MsnTransportError(
					`HTTP ${res.status} — the device refused the request. Check that this computer's IP address is on ` +
						`the device's API whitelist and that HTTP control is enabled (device web UI → Network Service).`,
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
			// Allow "host" or "host:port" — the device itself uses 80/443, but a
			// port-forwarded setup may expose it elsewhere.
			const [hostname, portRaw] = this.opts.host.split(':')
			const port = portRaw ? Number(portRaw) : isHttps ? 443 : 80
			const headers: Record<string, string> = { ...(options.headers ?? {}) }
			if (options.body !== undefined) {
				headers['Content-Length'] = String(Buffer.byteLength(options.body))
			}

			const onResponse = (res: http.IncomingMessage): void => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () => {
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers })
				})
				res.on('error', (e) => reject(new MsnTransportError(e.message)))
			}

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
