# Security

## What WoT Lab is, and is not, built to withstand

WoT Lab is a development tool for prototyping virtual Web of Things devices. It is meant to run on
a machine you trust, for people you trust:

- A Thing Model's `logic.js` is `eval`'d in the lab's process with its full privileges. It is
  trusted code, not a sandbox.
- Things are served without authentication (`nosec`), on every network interface.
- The lab API under `/_lab` refuses writes from anything but a loopback address unless
  `WOT_LAB_ALLOW_REMOTE_WRITE=1` is set.

The README's [Security](README.md#security) section says what each of these means in practice.
Reports that come down to "a Thing Model can run code" or "an exposed lab is unauthenticated"
describe the design rather than a flaw in it. Anything that gets *around* these boundaries is a
vulnerability — for example a way to write through the lab API from another machine or from a web
page, to escape the models directory, or to get code past the `vre:effects` parser.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on <https://github.com/wintechis/wot-lab>.

Include what you did, what happened, and the version or commit.

Only the `main` branch is supported; fixes are not backported.
