// Permanent identifiers. Everything that can be referenced (resources, analyses, budget items, contracts,
// people...) has an id that never changes and is unique everywhere, so data from different people can be
// merged and the change log can always find what it talks about. What people see and type is the code,
// which can be renamed freely.
//
// An id is "<prefix>-<12 chars>": 8 for the time (seconds since 2020, base 32, so they sort by creation) and
// 4 random, plus a counter so ids made in the same second stay distinct. Same format as the Gambas version.

const DIGITS = "0123456789abcdefghjkmnpqrstvwxyz"; // base 32 without i, l, o, u
const EPOCH = Date.UTC(2020, 0, 1);

let last = 0;
let count = 0;

export function makeId(prefix: string): string {
  const now = Math.floor((Date.now() - EPOCH) / 1000);
  if (now === last) count++;
  else {
    last = now;
    count = 0;
  }
  const random = Math.floor(Math.random() * 1048576);
  return `${prefix}-${base32(now * 1024 + (count % 1024), 8)}${base32(random, 4)}`;
}

function base32(value: number, length: number): string {
  let s = "";
  while (length-- > 0) {
    s = DIGITS[value % 32] + s;
    value = Math.floor(value / 32);
  }
  return s;
}
