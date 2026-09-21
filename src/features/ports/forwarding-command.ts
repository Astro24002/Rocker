import type { ForwardingProfile, HostProfile } from "../../../electron/storage/types"

const safeSshArgument = /^[A-Za-z0-9_][A-Za-z0-9_.:+\[\]-]*$/
const safeForwardingAddress = /^[A-Za-z0-9_.:+\[\]-]+$/

export function forwardingSshCommand(profile: ForwardingProfile, host: HostProfile): string | undefined {
  if (!safeSshArgument.test(host.username) || ![host.host, profile.remoteAddress].every((value) => safeForwardingAddress.test(value))) return undefined
  if (![host.port, profile.localPort, profile.remotePort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535)) return undefined

  const address = (value: string): string => value.includes(":") && !value.startsWith("[") ? `[${value}]` : value
  const route = `${address(profile.localAddress)}:${profile.localPort}:${address(profile.remoteAddress)}:${profile.remotePort}`
  return `ssh -N -L "${route}" -p ${host.port} "${host.username}@${host.host}"`
}
