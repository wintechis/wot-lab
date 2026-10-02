import { Parser, Store } from 'n3';
import { createLoggers } from '../utils/debug.js';
import { SolidFetch } from './dpopFetch.js';

const { debug, warn } = createLoggers('solid');

/**
 * The serial numbers the lab stamps on what it builds, and what the pod's
 * containers are named after.
 *
 * One build makes one finished product, so a build and a serial are the same
 * thing counted two ways: the serial names the phone that came out of it, and it
 * names the two containers holding how that phone came to be — `traces/000007/`
 * and `products/000007/`. A timestamp named them before, which said when a run
 * happened and nothing about what it produced; a reader with a phone in hand and
 * its serial on the back can now find its history without knowing when it was
 * made.
 *
 * Every part written beside the phone gets a serial of its own, derived from the
 * build's: `000007-001`, `000007-002`. Two items must not share a serial, and a
 * battery is not the phone it went into — but it is *that* phone's battery, and a
 * serial that says so is worth more than an unrelated number.
 *
 * Serials are allocated in order and continue past whatever the pod already holds,
 * which is what makes them safe across restarts. The timestamps they replace were
 * unique by construction; a counter that began at one every time the lab came up
 * would have the second session overwrite the first session's traces and products.
 * So the pod is read once at startup and the count resumes from the highest serial
 * in it.
 *
 * A build is identified by the moment its run began — the Date the registry hands
 * out, which changes when an environment starts or is reset. That is the signal
 * that already distinguished one run from the next, so nothing new has to be
 * hooked for a serial to be allocated at exactly the right moment.
 */

const ldpContains = 'http://www.w3.org/ns/ldp#contains';

/**
 * How wide a serial is written. Six digits is a million builds, which is past
 * anything a lab session reaches, and a fixed width is what makes a pod's listing
 * sort in build order — `10` before `9` is the whole reason the records inside a
 * run are padded too.
 */
const serialDigits = 6;

/** How wide a part's number within a build is written. */
const partDigits = 3;

/**
 * Long enough for a pod on a slow link, short enough that an unreachable one does
 * not hold up the lab coming up. Shorter than the sink's own timeout on purpose:
 * this one is on the startup path, where a person is waiting at a prompt.
 */
const listingTimeoutMs = 5_000;

// The next serial to hand out. Resumed from the pod by `startSerials`; 1 until
// then, and 1 for a pod that holds no builds yet.
let nextBuild = 1;
// The build now going, and the run it belongs to — the moment that run began, as
// the registry reports it. A new moment is a new build.
let currentSerial: string | undefined;
let currentRunAt: number | undefined;
// Each product of the current build, by the serial written on it. Filled when the
// build's documents are written, which is the only point at which the lab knows
// which products the build produced and in what order they are recorded.
const itemSerials = new Map<string, string>();

/** Where the builds already in the pod are listed, given the container the lab writes into. */
export function productsContainerIn(container: string): string {
  return `${container}products/`;
}

function format(build: number): string {
  return String(build).padStart(serialDigits, '0');
}

/**
 * Resume the count past the builds the pod already holds.
 *
 * The members of `products/` are the builds: one container per serial, which is
 * exactly the list this needs and costs one GET to read. A pod that has none —
 * because nothing has been built into it yet, so the container is not even there —
 * starts at one, which is not a failure and is not reported as one.
 *
 * A listing that *fails* is reported, because the count then starts at one against
 * a pod that may already hold a build by that name, and the next build would
 * overwrite it. That is a pod granting append without read, or one that is down —
 * and in the second case nothing is going to be written anyway.
 */
export async function startSerials(productsContainer: string, podFetch?: SolidFetch): Promise<void> {
  const send = podFetch ?? fetch;
  try {
    const response = await send(productsContainer, {
      method: 'GET',
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(listingTimeoutMs)
    });
    if (response.status === 404 || response.status === 410) {
      debug(`No ${productsContainer} yet; serials start at ${format(nextBuild)}`);
      return;
    }
    if (!response.ok) {
      warn(`Could not list ${productsContainer} to continue serial numbers (${response.status} ${response.statusText}); starting at ${format(nextBuild)}, which may overwrite a build already in the pod`);
      return;
    }
    const store = new Store(new Parser({ baseIRI: productsContainer }).parse(await response.text()));
    const highest = store
      .getObjects(null, ldpContains, null)
      .map(member => serialOf(member.value))
      .reduce((max, serial) => (serial > max ? serial : max), 0);
    nextBuild = highest + 1;
    debug(highest
      ? `Pod holds builds up to ${format(highest)}; serials continue at ${format(nextBuild)}`
      : `Pod holds no numbered builds; serials start at ${format(nextBuild)}`);
  } catch (cause) {
    warn(`Could not list ${productsContainer} to continue serial numbers (${cause instanceof Error ? cause.message : String(cause)}); starting at ${format(nextBuild)}, which may overwrite a build already in the pod`);
  }
}

/**
 * The build a container name stands for, or 0 for a name that is not a serial.
 *
 * A container whose name the lab did not mint — one left there by hand, or by the
 * timestamp scheme this replaced — is not a build to count past. Ignoring it is
 * right: it cannot collide with a serial, because a serial is digits and it is not.
 */
function serialOf(memberIri: string): number {
  const name = decodeURIComponent(memberIri.replace(/\/$/, '').split('/').pop() ?? '');
  return /^\d+$/.test(name) ? Number.parseInt(name, 10) : 0;
}

/**
 * The serial of the build going now, allocating one if this is a new run.
 *
 * Called wherever the sink needs to know which run it is writing for, which is
 * often, so it is a comparison and a cache rather than work. `undefined` for a lab
 * with no environment running: there are no runs to number, and the pod's flat
 * containers take the records as they did before.
 */
export function buildSerial(runStartedAt: Date | undefined): string | undefined {
  if (runStartedAt === undefined || Number.isNaN(runStartedAt.getTime())) {
    return undefined;
  }
  const at = runStartedAt.getTime();
  if (at !== currentRunAt) {
    currentRunAt = at;
    currentSerial = format(nextBuild);
    nextBuild += 1;
    itemSerials.clear();
    debug(`Build ${currentSerial} begins`);
  }
  return currentSerial;
}

/**
 * Number the products of one build, in the order they are written.
 *
 * `products[0]` is the finished product the build was for, and it takes the
 * build's serial unsuffixed — the serial on the back of the phone is the serial of
 * the build that made it. Everything after it is a part, numbered in the order the
 * phone links them, which is the order these documents go to the pod.
 *
 * Idempotent per product, so a build that writes a product twice — or a run that
 * finishes a second phone — does not renumber what is already stamped.
 */
export function numberBuildProducts(products: string[]): void {
  if (currentSerial === undefined) {
    return;
  }
  let part = itemSerials.size;
  for (const id of products) {
    if (itemSerials.has(id)) {
      continue;
    }
    // The first product of the build is what the build is named after; the rest
    // are its parts. `part` counts what has been numbered rather than the position
    // in this list, so a second batch of products continues the numbering.
    itemSerials.set(id, part === 0
      ? currentSerial
      : `${currentSerial}-${String(part).padStart(partDigits, '0')}`);
    part += 1;
  }
}

/**
 * The serial written on one product of the build going now.
 *
 * Nothing until the build's documents are written, which is when its products are
 * numbered: a product asked about mid-build has no serial yet because the build has
 * not finished producing the thing the serial belongs to.
 */
export function productSerial(id: string): string | undefined {
  return itemSerials.get(id);
}
