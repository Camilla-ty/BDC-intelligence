// Parses the Investment Identifier Axis typed member from a NUM segments cell.
// Documented form (SOURCE_SCHEMAS 4.3): Axis(version)=text() pairs, semicolon-delimited.
// The fixture / abbreviated form InvestmentIdentifierAxis=text; is also accepted so the
// same rule version covers observed and test layouts. Exact member text is preserved.

const TYPED = /InvestmentIdentifierAxis\([^)]*\)=(.*?)\(\)(?:;|$)/;
const PLAIN = /InvestmentIdentifierAxis=([^;]+)/;

export function parseIdentifierMemberFromSegments(segments) {
  if (segments == null || segments === "") return null;
  if (typeof segments !== "string") return null;
  const typed = segments.match(TYPED);
  if (typed) {
    const member = typed[1];
    return member === "" ? null : member;
  }
  const plain = segments.match(PLAIN);
  if (plain) {
    const member = plain[1];
    return member === "" ? null : member;
  }
  return null;
}
