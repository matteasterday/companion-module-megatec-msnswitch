import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, buildVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { MsnClient, MsnTransportError, type MsnClientOptions } from './msn/client.js'
import { blankState, type ControlAction, type DeviceState, type OutletTarget } from './msn/types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	/** Current normalized device state — read by actions and feedbacks. */
	state: DeviceState = blankState()

	private client?: MsnClient
	private pollTimer?: ReturnType<typeof setTimeout>
	private refreshTimer?: ReturnType<typeof setTimeout>
	private pollInFlight = false
	private destroyed = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.restart()
	}

	async destroy(): Promise<void> {
		this.destroyed = true
		this.stopTimers()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.restart()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}
	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}
	updatePresets(): void {
		UpdatePresets(this)
	}
	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	// --------------------------------------------------------------- lifecycle

	private clientOptions(): MsnClientOptions {
		return {
			host: this.config.host,
			protocol: this.config.protocol,
			apiVersion: this.config.apiVersion,
			username: this.config.username ?? '',
			password: this.config.password ?? '',
			timeoutMs: 4000,
			log: (level, message) => this.log(level, message),
		}
	}

	/** (Re)create the client and (re)start polling after init / config change. */
	private restart(): void {
		this.stopTimers()
		this.state = blankState()

		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Set the switch IP address')
			this.publish()
			return
		}

		this.client = new MsnClient(this.clientOptions())
		this.updateStatus(InstanceStatus.Connecting)
		void this.pollLoop()
	}

	private stopTimers(): void {
		if (this.pollTimer) clearTimeout(this.pollTimer)
		if (this.refreshTimer) clearTimeout(this.refreshTimer)
		this.pollTimer = undefined
		this.refreshTimer = undefined
	}

	private async pollLoop(): Promise<void> {
		if (this.destroyed || !this.client) return
		await this.poll()
		if (!this.destroyed && this.config.polling) {
			this.pollTimer = setTimeout(() => void this.pollLoop(), Math.max(1, this.config.pollInterval) * 1000)
		}
	}

	// --------------------------------------------------------------- polling

	private async poll(): Promise<void> {
		if (this.pollInFlight || !this.client) return
		this.pollInFlight = true
		try {
			this.state = await this.client.getStatus()
			this.markReachable()
			this.publish()
		} catch (e) {
			this.handleTransportError(e, 'Polling')
		} finally {
			this.pollInFlight = false
		}
	}

	// --------------------------------------------------------------- commands

	/** Send an outlet/UIS control command; refresh state shortly after. Used by all actions. */
	async sendControl(target: OutletTarget, action: ControlAction, label: string): Promise<void> {
		if (!this.client) return
		try {
			await this.client.control(target, action)
			this.markReachable()
			this.scheduleRefresh()
		} catch (e) {
			this.handleTransportError(e, label)
		}
	}

	/** Ping the device heartbeat endpoint. */
	async sendHeartbeat(): Promise<void> {
		if (!this.client) return
		try {
			const hb = await this.client.heartbeat()
			this.log('info', `Heartbeat: ${hb}`)
			this.markReachable()
		} catch (e) {
			this.handleTransportError(e, 'Heartbeat')
		}
	}

	/** Optimistically merge a state change so buttons feel responsive before the poll. */
	applyOptimistic(partial: Partial<DeviceState>): void {
		Object.assign(this.state, partial)
		this.publish()
	}

	/** Optimistically set the on/off state of the outlet(s) targeted by a control command. */
	applyOptimisticOutlet(target: OutletTarget, on: boolean): void {
		if (target === 'outlet1' || target === 'outlet_all') this.state.outlets[0].on = on
		if (target === 'outlet2' || target === 'outlet_all') this.state.outlets[1].on = on
		this.publish()
	}

	/** Schedule a single quick poll after a control command. */
	private scheduleRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer)
		this.refreshTimer = setTimeout(() => void this.poll(), 700)
	}

	// --------------------------------------------------------------- helpers

	private markReachable(): void {
		if (!this.state.reachable) this.state.reachable = true
		this.updateStatus(InstanceStatus.Ok)
	}

	private handleTransportError(e: unknown, label: string): void {
		const msg = e instanceof MsnTransportError ? e.message : e instanceof Error ? e.message : String(e)
		this.state.reachable = false
		this.updateStatus(InstanceStatus.ConnectionFailure, msg)
		this.log('debug', `${label}: ${msg}`)
		this.publish()
	}

	/** Push the current state out to variables and feedbacks. */
	private publish(): void {
		this.setVariableValues(buildVariableValues(this.state))
		this.checkFeedbacks('connected', 'outlet_on', 'uis_on')
	}
}
