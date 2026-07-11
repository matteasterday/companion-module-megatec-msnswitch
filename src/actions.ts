import type ModuleInstance from './main.js'
import type { ControlAction, OutletTarget } from './msn/types.js'

/** The subset of OutletTarget selectable from the "Outlet Control" / "Toggle" actions. */
type OutletControlTarget = 'outlet1' | 'outlet2' | 'outlet_all'

export type ActionsSchema = {
	outlet_control: { options: { target: OutletControlTarget; action: ControlAction } }
	outlet_toggle: { options: { outlet: 'outlet1' | 'outlet2' } }
	uis_control: { options: { mode: 'on' | 'off' } }
	uis_toggle: { options: Record<string, never> }
	send_heartbeat: { options: Record<string, never> }
}

const TARGET_CHOICES = [
	{ id: 'outlet1', label: 'Outlet 1' },
	{ id: 'outlet2', label: 'Outlet 2' },
	{ id: 'outlet_all', label: 'All outlets' },
]

const ACTION_CHOICES = [
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
	{ id: 'reset', label: 'Reset (power cycle)' },
]

const OUTLET_CHOICES = [
	{ id: 'outlet1', label: 'Outlet 1' },
	{ id: 'outlet2', label: 'Outlet 2' },
]

/** Outlet indices in `self.state.outlets` targeted by a control command. */
function outletIndices(target: OutletTarget): number[] {
	if (target === 'outlet1') return [0]
	if (target === 'outlet2') return [1]
	if (target === 'outlet_all') return [0, 1]
	return []
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		outlet_control: {
			name: 'Outlet Control (On / Off / Reset)',
			options: [
				{ type: 'dropdown', id: 'target', label: 'Target', default: 'outlet1', choices: TARGET_CHOICES },
				{ type: 'dropdown', id: 'action', label: 'Action', default: 'on', choices: ACTION_CHOICES },
			],
			callback: async (e) => {
				const { target, action } = e.options
				const indices = outletIndices(target)
				if (action === 'reset') {
					// Reset only has an effect on outlets that are currently on — but only
					// skip when the state is actually known (polled at least once).
					if (self.state.reachable && !indices.some((i) => self.state.outlets[i]?.on)) {
						self.log('info', `Reset skipped: ${target} is not on`)
						return
					}
				} else {
					if (self.state.reachable && indices.every((i) => self.state.outlets[i]?.resetOnly)) {
						self.log('info', `${action} skipped: ${target} is configured reset-only on the device`)
						return
					}
					self.applyOptimisticOutlet(target, action === 'on')
				}
				await self.sendControl(target, action, `Outlet ${target} ${action}`)
			},
		},
		outlet_toggle: {
			name: 'Toggle Outlet',
			options: [{ type: 'dropdown', id: 'outlet', label: 'Outlet', default: 'outlet1', choices: OUTLET_CHOICES }],
			callback: async (e) => {
				if (!self.state.reachable) {
					self.log('info', `Toggle skipped: ${e.options.outlet} state is unknown (not connected yet)`)
					return
				}
				const idx = e.options.outlet === 'outlet1' ? 0 : 1
				if (self.state.outlets[idx].resetOnly) {
					self.log('info', `Toggle skipped: ${e.options.outlet} is configured reset-only on the device`)
					return
				}
				const next = !self.state.outlets[idx].on
				self.applyOptimisticOutlet(e.options.outlet, next)
				await self.sendControl(e.options.outlet, next ? 'on' : 'off', `Toggle ${e.options.outlet}`)
			},
		},
		uis_control: {
			name: 'UIS Auto-Reset On / Off',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Action',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
			],
			callback: async (e) => {
				self.applyOptimistic({ uisOn: e.options.mode === 'on' })
				await self.sendControl('uis', e.options.mode, `UIS ${e.options.mode}`)
			},
		},
		uis_toggle: {
			name: 'UIS Auto-Reset Toggle',
			options: [],
			callback: async () => {
				if (!self.state.reachable) {
					self.log('info', 'UIS toggle skipped: device state is unknown (not connected yet)')
					return
				}
				const next = !self.state.uisOn
				self.applyOptimistic({ uisOn: next })
				await self.sendControl('uis', next ? 'on' : 'off', `UIS ${next ? 'on' : 'off'}`)
			},
		},
		send_heartbeat: {
			name: 'Send Heartbeat',
			description:
				'Keepalive for the switch’s heartbeat monitor: tells it the monitored equipment is alive, deferring an auto-reset. Warning: the first heartbeat received ARMS the monitor — once armed, the switch power-cycles the outlet if heartbeats stop. Not needed for normal Companion control.',
			options: [],
			callback: async () => {
				await self.sendHeartbeat()
			},
		},
	})
}
