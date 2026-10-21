// Minimal IPv4 CIDR matcher — no external dependency. Honest limitation: IPv6
// addresses are not matched against IPv4 CIDR ranges (returns false), so an
// IPv6-only client will never match an allowlist entry written as IPv4 CIDR.
function ipToLong(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function cidrMatch(ip, cidr) {
  const cleanIp = (ip || "").replace("::ffff:", "");
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  const ipLong = ipToLong(cleanIp);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

module.exports = { cidrMatch };
