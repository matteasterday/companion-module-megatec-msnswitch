import {
	combineRgb,
	type CompanionPresetDefinitions,
	type CompanionPresetFeedback,
	type CompanionPresetSection,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

const white = combineRgb(255, 255, 255)
const dark = combineRgb(0, 0, 0)
const green = combineRgb(0, 153, 0)
const red = combineRgb(204, 0, 0)
const grey = combineRgb(40, 40, 40)

export function UpdatePresets(self: ModuleInstance): void {
	const v = (name: string): string => `$(${self.label}:${name})`
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	// ---- Per-outlet presets ----
	const outletGroup = (target: 'outlet1' | 'outlet2', number: 1 | 2): void => {
		const onFeedback: CompanionPresetFeedback<ModuleSchema['feedbacks']>[] = [
			{ feedbackId: 'outlet_on', options: { outlet: target }, style: { bgcolor: green, color: white } },
		]

		presets[`${target}_on`] = {
			type: 'simple',
			name: `Outlet ${number} On`,
			style: { text: `OUTLET ${number}\\nON`, size: '14', color: white, bgcolor: dark, show_topbar: false },
			steps: [{ down: [{ actionId: 'outlet_control', options: { target, action: 'on' } }], up: [] }],
			feedbacks: onFeedback,
		}
		presets[`${target}_off`] = {
			type: 'simple',
			name: `Outlet ${number} Off`,
			style: { text: `OUTLET ${number}\\nOFF`, size: '14', color: white, bgcolor: dark, show_topbar: false },
			steps: [{ down: [{ actionId: 'outlet_control', options: { target, action: 'off' } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'outlet_on',
					options: { outlet: target },
					isInverted: true,
					style: { bgcolor: red, color: white },
				},
			],
		}
		presets[`${target}_toggle`] = {
			type: 'simple',
			name: `Outlet ${number} Toggle`,
			style: {
				text: `OUTLET ${number}\\n${v(`outlet${number}_status`)}`,
				size: '14',
				color: white,
				bgcolor: dark,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'outlet_toggle', options: { outlet: target } }], up: [] }],
			feedbacks: onFeedback,
		}
		presets[`${target}_reset`] = {
			type: 'simple',
			name: `Outlet ${number} Reset`,
			style: { text: `OUTLET ${number}\\nRESET`, size: '14', color: white, bgcolor: dark, show_topbar: false },
			steps: [{ down: [{ actionId: 'outlet_control', options: { target, action: 'reset' } }], up: [] }],
			feedbacks: onFeedback,
		}
	}
	outletGroup('outlet1', 1)
	outletGroup('outlet2', 2)

	// ---- All outlets ----
	const allAction = (action: 'on' | 'off' | 'reset', label: string, id: string): void => {
		presets[id] = {
			type: 'simple',
			name: `All Outlets ${label}`,
			style: { text: `ALL\\n${label.toUpperCase()}`, size: '14', color: white, bgcolor: dark, show_topbar: false },
			steps: [{ down: [{ actionId: 'outlet_control', options: { target: 'outlet_all', action } }], up: [] }],
			feedbacks: [],
		}
	}
	allAction('on', 'On', 'all_on')
	allAction('off', 'Off', 'all_off')
	allAction('reset', 'Reset', 'all_reset')

	// ---- UIS ----
	const uisFeedback: CompanionPresetFeedback<ModuleSchema['feedbacks']>[] = [
		{ feedbackId: 'uis_on', options: {}, style: { bgcolor: green, color: white } },
	]
	presets['uis_on'] = {
		type: 'simple',
		name: 'UIS On',
		style: { text: 'UIS\\nON', size: '14', color: white, bgcolor: dark, show_topbar: false },
		steps: [{ down: [{ actionId: 'uis_control', options: { mode: 'on' } }], up: [] }],
		feedbacks: uisFeedback,
	}
	presets['uis_off'] = {
		type: 'simple',
		name: 'UIS Off',
		style: { text: 'UIS\\nOFF', size: '14', color: white, bgcolor: dark, show_topbar: false },
		steps: [{ down: [{ actionId: 'uis_control', options: { mode: 'off' } }], up: [] }],
		feedbacks: [{ feedbackId: 'uis_on', options: {}, isInverted: true, style: { bgcolor: red, color: white } }],
	}
	presets['uis_toggle'] = {
		type: 'simple',
		name: 'UIS Toggle',
		style: { text: `UIS\\n${v('uis_status')}`, size: '14', color: white, bgcolor: dark, show_topbar: false },
		steps: [{ down: [{ actionId: 'uis_toggle', options: {} }], up: [] }],
		feedbacks: uisFeedback,
	}

	// ---- Status displays ----
	presets['status_connected'] = {
		type: 'simple',
		name: 'Status: Connection',
		style: {
			text: `SWITCH\\n${v('outlet1_status')} / ${v('outlet2_status')}`,
			size: '14',
			color: white,
			bgcolor: grey,
			show_topbar: false,
		},
		steps: [],
		feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: green, color: white } }],
	}
	presets['status_uis'] = {
		type: 'simple',
		name: 'Status: UIS',
		style: { text: `UIS\\n${v('uis_status')}`, size: '14', color: white, bgcolor: grey, show_topbar: false },
		steps: [],
		feedbacks: uisFeedback,
	}

	const structure: CompanionPresetSection[] = [
		{
			id: 'outlet1',
			name: 'Outlet 1',
			definitions: [
				{
					id: 'outlet1_grp',
					name: 'Outlet 1',
					type: 'simple',
					presets: ['outlet1_on', 'outlet1_off', 'outlet1_toggle', 'outlet1_reset'],
				},
			],
		},
		{
			id: 'outlet2',
			name: 'Outlet 2',
			definitions: [
				{
					id: 'outlet2_grp',
					name: 'Outlet 2',
					type: 'simple',
					presets: ['outlet2_on', 'outlet2_off', 'outlet2_toggle', 'outlet2_reset'],
				},
			],
		},
		{
			id: 'all_outlets',
			name: 'All Outlets',
			definitions: [
				{ id: 'all_grp', name: 'All Outlets', type: 'simple', presets: ['all_on', 'all_off', 'all_reset'] },
			],
		},
		{
			id: 'uis',
			name: 'UIS Auto-Reset',
			definitions: [
				{ id: 'uis_grp', name: 'UIS Auto-Reset', type: 'simple', presets: ['uis_on', 'uis_off', 'uis_toggle'] },
			],
		},
		{
			id: 'status',
			name: 'Status',
			definitions: [{ id: 'status_grp', name: 'Status', type: 'simple', presets: ['status_connected', 'status_uis'] }],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
