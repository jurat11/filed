/** Display text for the "likely cap-exempt" rules in etl/cap_exempt.py (decisions D30). */
export const CAP_EXEMPT_RULES: Record<string, string> = {
  irs_nonprofit: "the IRS lists its tax ID as a 501(c)(3) in higher education or research",
  naics_611310: "most of its LCAs give NAICS 611310 (colleges and universities)",
  name_higher_ed: "its name suggests a college or university, with an education or health care NAICS code",
};
