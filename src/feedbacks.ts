import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	outlet_on: { type: 'boolean'; options: { outlet: 'outlet1' | 'outlet2' } }
	uis_on: { type: 'boolean'; options: Record<string, never> }
	connected: { type: 'boolean'; options: Record<string, never> }
	connection_lossy: { type: 'boolean'; options: { connection: 'connection1' | 'connection2'; threshold: number } }
}

const white = combineRgb(255, 255, 255)
const green = combineRgb(0, 153, 0)
const red = combineRgb(204, 0, 0)

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
		connection_lossy: {
			name: 'Monitored connection packet loss at/above threshold',
			type: 'boolean',
			defaultStyle: { bgcolor: red, color: white },
			options: [
				{
					type: 'dropdown',
					id: 'connection',
					label: 'Monitored connection',
					default: 'connection1',
					choices: [
						{ id: 'connection1', label: 'Connection 1' },
						{ id: 'connection2', label: 'Connection 2' },
					],
				},
				{
					type: 'number',
					id: 'threshold',
					label: 'Packet loss threshold (%)',
					default: 50,
					min: 1,
					max: 100,
				},
			],
			callback: (fb) => {
				const idx = fb.options.connection === 'connection1' ? 0 : 1
				const conn = self.state.connections[idx]
				return !!conn && conn.lost >= Number(fb.options.threshold)
			},
		},
	})
}
