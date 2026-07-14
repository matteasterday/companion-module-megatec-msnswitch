import { type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	protocol: 'http' | 'https'
	apiVersion: 'json' | 'legacy'
	username: string
	password: string
	polling: boolean
	pollInterval: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'MSNSwitch2 (UIS-622B)',
			width: 12,
			value:
				'Controls a Mega System Technologies MSNSwitch2 (UIS-622B) 2-outlet IP power switch over HTTP(S). ' +
				'Both API versions require the device web UI user name and password. Firmware 3207 and newer use the ' +
				'JSON API and additionally require this computer’s IP address on the device’s API whitelist ' +
				'(device web UI → Network Service). Older firmware (around the A624 era) uses the legacy CGI/XML API.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Switch IP address / hostname',
			width: 8,
			default: '',
			tooltip: 'e.g. 192.168.0.10',
		},
		{
			type: 'dropdown',
			id: 'protocol',
			label: 'Protocol',
			width: 4,
			default: 'http',
			choices: [
				{ id: 'http', label: 'HTTP' },
				{ id: 'https', label: 'HTTPS' },
			],
		},
		{
			type: 'dropdown',
			id: 'apiVersion',
			label: 'API version',
			width: 6,
			default: 'json',
			choices: [
				{ id: 'json', label: 'Firmware 3207+ (JSON)' },
				{ id: 'legacy', label: 'Older firmware (CGI/XML)' },
			],
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'User name',
			width: 6,
			default: '',
			tooltip: 'The device web UI login, e.g. admin',
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password',
			width: 6,
			default: '',
			tooltip: 'The device web UI password',
		},
		{
			type: 'checkbox',
			id: 'polling',
			label: 'Poll switch for status / feedback',
			width: 4,
			default: true,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (seconds)',
			width: 4,
			default: 5,
			min: 1,
			max: 600,
		},
	]
}
