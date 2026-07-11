import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	outlet_on: { type: 'boolean'; options: { outlet: 'outlet1' | 'outlet2' } }
	uis_on: { type: 'boolean'; options: Record<string, never> }
	connected: { type: 'boolean'; options: Record<string, never> }
}

const white = combineRgb(255, 255, 255)
const green = combineRgb(0, 153, 0)

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		outlet_on: {
			name: 'Outlet is on',
			type: 'boolean',
			defaultStyle: { bgcolor: green, color: white },
			options: [
				{
					type: 'dropdown',
					id: 'outlet',
					label: 'Outlet',
					default: 'outlet1',
					choices: [
						{ id: 'outlet1', label: 'Outlet 1' },
						{ id: 'outlet2', label: 'Outlet 2' },
					],
				},
			],
			callback: (fb) => {
				const idx = fb.options.outlet === 'outlet1' ? 0 : 1
				return self.state.outlets[idx].on
			},
		},
		uis_on: {
			name: 'UIS auto-reset is on',
			type: 'boolean',
			defaultStyle: { bgcolor: green, color: white },
			options: [],
			callback: () => self.state.uisOn,
		},
		connected: {
			name: 'Connected to switch',
			type: 'boolean',
			defaultStyle: { bgcolor: green, color: white },
			options: [],
			callback: () => self.state.reachable,
		},
	})
}
