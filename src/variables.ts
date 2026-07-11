import type ModuleInstance from './main.js'
import type { DeviceState } from './msn/types.js'

export type VariablesSchema = {
	outlet1_name: string
	outlet1_status: string
	outlet2_name: string
	outlet2_status: string
	uis_status: string
	last_heartbeat: string
	connection1_label: string
	connection1_host: string
	connection1_resp: string
	connection1_lost: string
	connection2_label: string
	connection2_host: string
	connection2_resp: string
	connection2_lost: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		outlet1_name: { name: 'Outlet 1 name' },
		outlet1_status: { name: 'Outlet 1 status (On / Off)' },
		outlet2_name: { name: 'Outlet 2 name' },
		outlet2_status: { name: 'Outlet 2 status (On / Off)' },
		uis_status: { name: 'UIS auto-reset status (On / Off)' },
		last_heartbeat: { name: 'Last heartbeat response (timestamp reported by the device)' },
		connection1_label: { name: 'Monitored connection 1 — label' },
		connection1_host: { name: 'Monitored connection 1 — host' },
		connection1_resp: { name: 'Monitored connection 1 — response time (ms)' },
		connection1_lost: { name: 'Monitored connection 1 — packet loss (%)' },
		connection2_label: { name: 'Monitored connection 2 — label' },
		connection2_host: { name: 'Monitored connection 2 — host' },
		connection2_resp: { name: 'Monitored connection 2 — response time (ms)' },
		connection2_lost: { name: 'Monitored connection 2 — packet loss (%)' },
	})
}

const onOff = (b: boolean): string => (b ? 'On' : 'Off')

/** Project the current state into the typed variable value map. */
export function buildVariableValues(state: DeviceState, lastHeartbeat: string): VariablesSchema {
	const conn = (i: number) => state.connections[i]
	return {
		outlet1_name: state.outlets[0].name || 'Outlet 1',
		outlet1_status: onOff(state.outlets[0].on),
		outlet2_name: state.outlets[1].name || 'Outlet 2',
		outlet2_status: onOff(state.outlets[1].on),
		uis_status: onOff(state.uisOn),
		last_heartbeat: lastHeartbeat,
		connection1_label: conn(0)?.label ?? '',
		connection1_host: conn(0)?.host || conn(0)?.ip || '',
		connection1_resp: conn(0) ? String(conn(0).resp) : '',
		connection1_lost: conn(0) ? String(conn(0).lost) : '',
		connection2_label: conn(1)?.label ?? '',
		connection2_host: conn(1)?.host || conn(1)?.ip || '',
		connection2_resp: conn(1) ? String(conn(1).resp) : '',
		connection2_lost: conn(1) ? String(conn(1).lost) : '',
	}
}
