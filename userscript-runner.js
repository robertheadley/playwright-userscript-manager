const fs = require('fs').promises; // Use fs.promises for async operations
const path = require('path');
const { URL } = require('url'); // Use URL class for parsing

/**
 * Parses the metadata block of a userscript.
 * @param {string} scriptContent - The content of the userscript.
 * @returns {object} - An object containing the parsed metadata.
 */
function parseMetadata(scriptContent) {
    const metadata = {};
    const metaBlock = scriptContent.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if (!metaBlock) {
        // If no block found, treat as invalid script for matching purposes
        console.warn('Could not find metadata block in script.');
        return { match: [], runAt: 'document-start', name: ['Unnamed Script'] }; // Return empty match array
    }

    const lines = metaBlock[1].trim().split('\n');
    for (let line of lines) {
        line = line.trim();
        const match = line.match(/^\/\/\s*@(\S+)\s+(.*)/);
        if (match) {
            const [, key, value] = match;
            const trimmedValue = value.trim();
            // Initialize as array if first time seeing key
            if (!metadata[key]) {
                metadata[key] = [];
            }
            metadata[key].push(trimmedValue);
        }
    }

    // Provide defaults and validation
    if (!metadata.match || metadata.match.length === 0) {
        // GM spec requires at least one @match or @include. We only support @match.
        // If none provided, it shouldn't match anything.
        console.warn(`Script "${metadata.name?.[0] || 'Unnamed'}" has no @match rules. It will not run.`);
        metadata.match = []; // Explicitly set to empty array
    }

    // Use the first @run-at value, default to document-start
    metadata.runAt = metadata['run-at']?.[0]?.toLowerCase() || 'document-start';
    const validRunAt = ['document-start', 'document-end', 'document-idle'];
    if (!validRunAt.includes(metadata.runAt)) {
        console.warn(`Invalid @run-at value "${metadata.runAt}" in script "${metadata.name?.[0] || 'Unnamed'}". Defaulting to "document-start".`);
        metadata.runAt = 'document-start';
    }

     if (!metadata.name || metadata.name.length === 0) {
         metadata.name = ['Unnamed Script']; // Default name if missing
     }


    return metadata;
}

/**
 * Converts a Greasemonkey match pattern to a RegExp.
 * Handles schemes, domain wildcards, and path wildcards according to GM/VM specs.
 * See: https://violentmonkey.github.io/api/match/
 * @param {string} pattern - The match pattern string.
 * @returns {RegExp | null} - A RegExp object or null if the pattern is invalid.
 */
function matchPatternToRegExp(pattern) {
    if (pattern === '<all_urls>') {
        // Matches http and https schemes only.
        return /^https?:\/\/.*/;
    }

    try {
        // Match pattern structure: scheme://host/path
        // Scheme: *, http, https
        // Host: *, *.domain, domain
        // Path: /*, /path/*, /path
        const match = pattern.match(/^(?<scheme>\*|https?):\/\/(?<host>[^\/]+)(?<path>\/.*)?$/);
        if (!match || !match.groups) {
            // Support for file:// scheme could be added if needed, but less common for GM scripts
            if (/^file:\/\//.test(pattern)) {
                 console.warn(`Match pattern "${pattern}" uses unsupported 'file://' scheme. Skipping.`);
                 return null;
            }
             if (/^(\*|https?):\/\/\*\//.test(pattern)) {
                 console.warn(`Match pattern "${pattern}" has an invalid host ('*'). Skipping.`);
                 return null; // Host cannot be '*' if path is also specified
             }
            console.warn(`Invalid match pattern format: "${pattern}". Must be scheme://host/path. Skipping.`);
            return null;
        }

        let { scheme, host, path: pathPattern } = match.groups;

        // 1. Scheme part
        // '*' matches http or https.
        const schemeRegex = scheme === '*' ? 'https?' : scheme;

        // 2. Host part
        // Escape dots and other regex special characters in the host.
        let hostRegex = host.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); // Escape potential regex chars first
        if (hostRegex.startsWith('*\\.')) {
            // Handle *.domain.com -> matches domain.com and subdomains
            // Requires escaping the literal '.' after '*'
            hostRegex = `(?:[^\\/.]+\\.)?${hostRegex.substring(3)}`; // Optional subdomain part + rest of domain
        } else if (hostRegex === '*') {
             // '*' host only allowed if path is not specified (handled by initial regex)
             // or if scheme is also '*' (e.g., *://*/* is invalid, but handled above)
             // If we reach here with host '*', it implies a pattern like 'http://*' which is invalid per spec.
             // However, some interpretations allow it to match any host for that scheme. Let's allow it for flexibility,
             // matching any sequence of non-slash characters.
             console.warn(`Match pattern "${pattern}" uses a wildcard host ('*') which might have ambiguous interpretations. Matching any host.`);
             hostRegex = '[^\\/]+';
        }
        // Ensure the host doesn't contain '*' except for the *. prefix case already handled.
        else if (hostRegex.includes('*')) {
            console.warn(`Invalid wildcard usage in host part of pattern: "${pattern}". Skipping.`);
            return null;
        }


        // 3. Path part
        // Escape regex characters, then replace GM's '*' wildcard with '.*'
        const pathRegex = pathPattern
            ? pathPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
            : '(/.*)?'; // If no path is specified, match '/' or any path starting with '/'

        const finalRegexString = `^${schemeRegex}:\/\/${hostRegex}${pathRegex}$`;
        return new RegExp(finalRegexString);
    } catch (e) {
        console.error(`Error converting match pattern "${pattern}" to RegExp:`, e);
        return null;
    }
}

/**
 * Checks if a URL matches any of the provided Greasemonkey match patterns.
 * @param {string[]} patterns - An array of match pattern strings.
 * @param {string} urlString - The URL string to test.
 * @returns {boolean} - True if the URL matches any pattern, false otherwise.
 */
function urlMatches(patterns, urlString) {
    let parsedUrl;
    try {
        parsedUrl = new URL(urlString);
        // Basic check: GM scripts usually target http/https
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            // console.warn(`URL "${urlString}" uses non-http/https protocol. Skipping match check.`);
            return false;
        }
    } catch (e) {
        console.error(`Invalid URL provided for matching: "${urlString}"`);
        return false;
    }

    // Use the URL *without* the hash for matching, as per GM spec.
    const urlToMatch = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search;


    for (const pattern of patterns) {
        const regex = matchPatternToRegExp(pattern);
        if (regex && regex.test(urlToMatch)) {
            // console.log(`URL "${urlToMatch}" matched pattern "${pattern}" (Regex: ${regex})`);
            return true;
        }
    }
    // console.log(`URL "${urlToMatch}" did not match any patterns: ${patterns.join(', ')}`);
    return false;
}


/**
 * Loads userscripts from a specified directory asynchronously.
 * Parses metadata including @match and @run-at.
 * @param {string} directory - The directory containing userscripts.
 * @returns {Promise<Array<object>>} - A promise that resolves to an array of script objects.
 */
async function loadUserscripts(directory) {
    const scripts = [];
    let files;

    try {
        files = await fs.readdir(directory);
    } catch (err) {
        console.error(`Error reading userscript directory "${directory}":`, err.message);
        // If directory doesn't exist or isn't readable, return empty array
        if (err.code === 'ENOENT') {
             console.warn(`Userscript directory "${directory}" not found.`);
             return [];
        }
         if (err.code === 'EACCES') {
             console.warn(`Permission denied reading userscript directory "${directory}".`);
             return [];
         }
        throw err; // Re-throw other unexpected errors
    }

    for (const file of files) {
        // Ensure it's a .user.js file
        if (!file.endsWith('.user.js')) continue;

        const fullPath = path.join(directory, file);
        let content;
        try {
            content = await fs.readFile(fullPath, 'utf8');
        } catch (err) {
            console.error(`Error reading userscript file "${fullPath}":`, err.message);
            continue; // Skip this script if reading fails
        }

        try {
            const metadata = parseMetadata(content); // Already handles defaults and validation

            // Basic validation: ensure match patterns exist
            if (!metadata.match || metadata.match.length === 0) {
                 console.warn(`Skipping script "${file}" because it has no valid @match patterns.`);
                 continue;
            }

            scripts.push({
                path: fullPath,
                name: metadata.name?.[0] || path.basename(file), // Use @name or filename
                content,
                matchPatterns: metadata.match,
                runAt: metadata.runAt, // Already validated in parseMetadata
                metadata // Store full metadata
            });
        } catch (err) {
            // Catch errors specifically from parseMetadata if it were to throw
            console.error(`Error processing metadata for script "${fullPath}":`, err.message);
            // Optionally skip script on metadata parse error
            // continue;
        }
    }

    if (scripts.length > 0) {
        console.log(`Loaded ${scripts.length} userscripts from "${directory}".`);
    } else {
        console.log(`No userscripts found or loaded from "${directory}".`);
    }
    return scripts;
}


module.exports = {
    loadUserscripts,
    urlMatches,
    // Internal helpers not exported by default
    // parseMetadata,
    // matchPatternToRegExp
};