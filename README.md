# companion-module-megatec-msnswitch

Control and monitor **Mega System Technologies MSNSwitch2** (UIS-622B) from [Bitfocus Companion](https://bitfocus.io/companion) over the network.

No special hardware or cables are required — the module talks to the device's built-in HTTP/HTTPS control interface using a REST API (JSON for firmware 3207+, or legacy CGI/XML for older firmware). Just enter the device's IP address and you get full outlet control (on/off/reset), UIS auto-reset management, and live status (power states, UIS status, connection…) that updates automatically.

> **What is it?** The MSNSwitch2 is a 2-outlet network power switch with UIS (Uninterrupted Internet Service) auto-reset — it monitors internet connectivity and automatically power-cycles its outlets (typically a modem/router) when the connection is lost. It's commonly used to remotely power-cycle equipment or automate system reboots.

See [HELP.md](./companion/HELP.md) for plain-language setup help, and [LICENSE](./LICENSE).

## Features

**Buttons / actions**

- Power on / off — per outlet or all outlets together; toggle — per outlet
- Reset outlet — power cycle an outlet (briefly off, then back on)
- UIS auto-reset — enable / disable / toggle auto-reset functionality
- Send heartbeat — keepalive for the switch's heartbeat monitor (tells it the monitored equipment is alive, deferring an auto-reset)

**Feedbacks** (colour your buttons by live state)

- Outlet 1 / Outlet 2 on
- UIS active
- Connected
- Monitored connection packet loss at/above a threshold

**Variables** (updated by polling)

- Outlet power states and names
- UIS status, last heartbeat timestamp
- Monitored-connection details (label, host, response time, packet loss) for connections 1–2

**Presets** — ready-made buttons for outlet control, UIS auto-reset, and status displays.

## Configuration

| Setting                   | What it's for                                                |
| ------------------------- | ------------------------------------------------------------ |
| Device IP address         | The switch's address on your network (`host` or `host:port`) |
| HTTP/HTTPS protocol       | HTTP (port 80) or HTTPS (port 443)                          |
| API version               | JSON API (firmware 3207+) or Legacy CGI/XML                 |
| HTTP user name / password | Only for legacy CGI/XML; leave blank for JSON API           |
| Poll device for status    | Keeps buttons and variables up to date                       |
| Poll interval (seconds)   | How often to check (default `5`)                             |

For the JSON API (firmware 3207+), no credentials are needed — just ensure the HTTP/HTTPS API is enabled in the device's Network Service settings. For legacy firmware, use the username and password you set in the device's web UI.

## Supported devices

- Mega System Technologies **MSNSwitch2** (UIS-622B)
- Other Mega System Technologies MSN series switches with HTTP/HTTPS control

## Development

`yarn build` compiles the module, `yarn dev` watches for changes, `yarn lint` checks formatting/lint, and `yarn package` builds the installable bundle.

See the [Companion module documentation](https://github.com/bitfocus/companion-module-template) for more information on building Companion modules.
