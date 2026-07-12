export function formatMailboxFrom(address, requestedName = "", fallbackName = "") {
  const displayName = String(requestedName || fallbackName || "")
    .replace(/[\r\n"]/g, "")
    .trim();
  return displayName ? `"${displayName}" <${address}>` : address;
}
