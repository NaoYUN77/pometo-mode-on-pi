/**
 * Resolve pi's own packages for a test that imports an extension directly.
 *
 * The extension imports `@earendil-works/pi-ai`, `pi-tui`, `pi-agent-core` and
 * `typebox`. They are peer dependencies: pi provides them at runtime, and pi keeps
 * its copies inside its own `node_modules`, so Node cannot find them from this
 * repo. In production pi resolves them; here a loader hook points a bare
 * specifier at pi's installation.
 *
 * Nothing is written to disk and no `node_modules` is created. When pi is not
 * installed, `piRoot()` returns undefined and the caller skips the test that needs
 * it, rather than failing for a reason that is not the code's fault.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PEER = ["@earendil-works/", "typebox"];
const OWN = ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

/** The installed pi package directory, or undefined when there is none. */
export function piRoot() {
	const candidates = [];
	try {
		// npm's global prefix is where `pi` itself is installed on this machine. On
		// Windows npm is a .cmd shim, so it needs a shell to run.
		const npm = process.platform === "win32" ? "npm.cmd" : "npm";
		const global = execFileSync(npm, ["root", "-g"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			shell: process.platform === "win32",
		}).trim();
		candidates.push(path.join(global, "@earendil-works", "pi-coding-agent"));
	} catch {
		// npm missing is not fatal; the other candidates may still hit.
	}
	// A hoisted install puts the package beside its peers.
	candidates.push(path.join(path.resolve(import.meta.dirname, ".."), "node_modules", "@earendil-works", "pi-coding-agent"));
	return candidates.find((dir) => existsSync(path.join(dir, "package.json")));
}

/**
 * Point every bare specifier a peer provides at pi's own copy.
 *
 * pi's peers live either beside it or inside its `node_modules`, so resolving from
 * a parent URL inside its directory finds them either way.
 */
export async function resolve(specifier, context, next) {
	if (!PEER.some((p) => specifier === p || specifier.startsWith(p))) return next(specifier, context);
	const root = piRoot();
	if (!root) return next(specifier, context);
	const anchor = pathToFileURL(path.join(root, "__resolve__.mjs")).href;
	return next(specifier, { ...context, parentURL: anchor });
}

export { OWN };

export async function initialize() {}
export async function load(url, context, next) {
	return next(url, context);
}
