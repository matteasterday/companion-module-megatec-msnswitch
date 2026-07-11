/**
 * Normalized device state and small domain types shared between the HTTP client and the
 * rest of the module. Both the modern JSON API (firmware 3207+) and the legacy CGI/XML
 * API (firmware A624-era) are normalized into the same `DeviceState` shape so the rest
 * of the module (actions, feedbacks, variables) never needs to know which API is active.
 */

/** Which outlet(s) / function a control command targets. */
export type OutletTarget = 'outlet1' | 'outlet2' | 'outlet_all' | 'uis'

/** What a control command does. */
export type ControlAction = 'on' | 'off' | 'reset'

/** A single outlet's normalized state. */
export interface OutletState {
	name: string
	on: boolean
	/** True when this outlet only supports the Reset action (device configuration). */
	resetOnly: boolean
}

/** One entry from the device's monitored-connection list ("ping to reset" targets). */
export interface ConnectionState {
	assign: 'NONE' | 'OUTLET1' | 'OUTLET2' | 'BOTH'
	label: string
	host: string
	ip: string
	/** Response time in milliseconds. */
	resp: number
	timeout: number
	/** Packet loss percentage. */
	lost: number
}

/** Everything the module tracks and exposes as variables/feedbacks. */
export interface DeviceState {
	reachable: boolean
	outlets: [OutletState, OutletState]
	uisOn: boolean
	connections: ConnectionState[]
}

/** A fresh, "unknown" state. */
export function blankState(): DeviceState {
	return {
		reachable: false,
		outlets: [
			{ name: 'Outlet 1', on: false, resetOnly: false },
			{ name: 'Outlet 2', on: false, resetOnly: false },
		],
		uisOn: false,
		connections: [],
	}
}

// ------------------------------------------------------------- raw JSON API shapes

/** Raw shape of one entry in `/api/status` -> `connections`. */
export interface JsonConnection {
	assign?: 'NONE' | 'OUTLET1' | 'OUTLET2' | 'BOTH'
	label?: string
	host?: string
	ip?: string
	resp?: number
	timeout?: number
	lost?: number
}

/** Raw shape of one entry in `/api/status` -> `status.outlet`. */
export interface JsonOutlet {
	name?: string
	status?: boolean
	reset_only?: boolean
}

/** Raw shape of the `/api/status` response. */
export interface JsonStatusResponse {
	connections?: JsonConnection[]
	status?: {
		outlet?: JsonOutlet[]
		uis?: boolean
	}
}

/** Raw shape of the `/api/control` response. */
export interface JsonControlResponse {
	outlet?: boolean[]
	uis?: boolean
}

/** Raw shape of the `/api/heartbeat` response. */
export interface JsonHeartbeatResponse {
	heartbeat?: string
}
