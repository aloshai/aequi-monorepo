# Aequi Trademark Policy

## Trademarks

The following are trademarks of Aequi (collectively, the "Aequi Marks"):

- The name **"Aequi"**
- The phrase **"Powered by Aequi"**
- The Aequi logo and associated brand assets

## Usage Requirements

### 1. User-facing applications (frontend / UI)

Any derivative work, fork, or product built on top of this software that
provides a user-facing interface (web, mobile, desktop, or otherwise) **must**
display a clearly visible "Powered by Aequi" notice. The notice must:

- Be rendered as readable text (minimum equivalent of 11px at standard
  viewport sizes);
- Include a hyperlink to `https://github.com/aloshai/aequi-monorepo` or the official Aequi
  website when technically feasible;
- Be visible without user interaction (i.e., not hidden behind a menu or
  collapsed section).

The default `<PoweredBy />` component shipped in
`apps/web/src/components/PoweredBy.tsx` satisfies this requirement. **Do not
remove it.**

### 2. Back-end services / APIs

Any derivative work that operates as a back-end service or API (with no
user-facing interface) **must** include the HTTP response header:

```
X-Powered-By: Aequi
```

on every response. The default server configuration already sets this header.

### 3. What you may NOT do

- Remove, hide, or obscure the "Powered by Aequi" notice or the
  `X-Powered-By` header.
- Use the Aequi Marks in a way that implies endorsement, sponsorship, or
  official affiliation with the Aequi project without prior written permission.
- Register any domain name, social media account, or trademark that includes
  the Aequi Marks.

### 4. What you MAY do

- Add your own branding alongside (not replacing) the Aequi attribution.
- Modify the visual style of the "Powered by Aequi" notice (color, position,
  font) as long as it remains clearly readable and visible.
- Use the name "Aequi" in truthful, descriptive statements about the origin
  of the software (e.g., "built on Aequi" or "uses Aequi technology").

## Enforcement

Failure to comply with this trademark policy constitutes a violation of the
terms under which the Aequi Marks are licensed. The Aequi project reserves
the right to revoke trademark usage permissions for non-compliant parties.

## Contact

For trademark usage inquiries or permission requests, open an issue at
https://github.com/aloshai/aequi-monorepo or contact the project maintainers.
