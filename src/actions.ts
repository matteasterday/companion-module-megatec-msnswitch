import type ModuleInstance from './main.js'
import type { ControlAction, OutletTarget } from './msn/types.js'

/** The subset of OutletTarget selectable from the "Outlet Control" / "Toggle" actions. */
type OutletControlTarget = 'outlet1' | 'outlet2' | 'outlet_all'

export type ActionsSchema = {
	outlet_control: { options: { target: OutletControlTarget; action: ControlAction } }
	outlet_toggle: { options: { outlet: 'outlet1' | 'outlet2' } }
	uis_control: { options: { mode: 'on' | 'off' } }
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
				if (action === 'reset') {
					// Reset only has an effect on outlets that are currently on.
					const anyOn = outletIndices(target).some((i) => self.state.outlets[i]?.on)
					if (!anyOn) {
						self.log('debug', `Reset skipped: ${target} is not on`)
						return
					}
				} else {
					self.applyOptimisticOutlet(target, action === 'on')
				}
				await self.sendControl(target, action, `Outlet ${target} ${action}`)
			},
		},
		outlet_toggle: {
			name: 'Toggle Outlet',
			options: [{ type: 'dropdown', id: 'outlet', label: 'Outlet', default: 'outlet1', choices: OUTLET_CHOICES }],
			callback: async (e) => {
				const idx = e.options.outlet === 'outlet1' ? 0 : 1
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
		send_heartbeat: {
			name: 'Send Heartbeat',
			options: [],
			callback: async () => {
				await self.sendHeartbeat()
			},
		},
	})
}
