// ==UserScript==
// @name        GM API Polyfill for Playwright
// @namespace   Violentmonkey Scripts
// @match       *://*/*
// @grant       none
// @version     1.2 // Increment version
// @author      -
// @description Polyfills Greasemonkey APIs for use within Playwright's environment, using window bridge functions for storage.
// @run-at      document-start
// ==/UserScript==

(function() {
    'use strict';

    if (typeof unsafeWindow === 'undefined') {
        // Define unsafeWindow if it doesn't exist (common in non-GM environments)
        // In Playwright's isolated world, window should be safe enough for this purpose.
        window.unsafeWindow = window;
    }

    // --- Helper Functions ---
    const logPrefix = '[GM Polyfill]';
    const log = (...args) => console.log(logPrefix, ...args);
    const warn = (...args) => console.warn(logPrefix, ...args);
    const error = (...args) => console.error(logPrefix, ...args);

    // --- Storage for Registered Menu Commands ---
    // Exposed on window for potential external access/triggering if needed
    unsafeWindow.__registeredMenuCommands = {};

    // --- GM_info ---
    // Basic implementation, details might need adjustment based on runner context
    const scriptInfo = {
        script: {
            name: 'Polyfilled Script (Name Unknown)', // Placeholder, ideally runner injects specific script info
            namespace: 'Polyfill Namespace',
            description: 'Running within Playwright GM Polyfill',
            version: '1.2', // Match script version
            // Metadata can be expanded if runner provides it
            // grants: [], // Populated below
            // requires: [],
            // resources: {},
            // includes: [],
            // excludes: [],
            matches: ['*://*/*'], // Placeholder
            'run-at': 'document-start', // Placeholder
        },
        scriptMetaStr: '// ==UserScript==\n// @name Polyfilled Script...\n// ==/UserScript==', // Placeholder
        scriptHandler: 'Playwright GM Polyfill',
        version: 'N/A', // Playwright version? Polyfill version?
        injectInto: 'page', // Playwright injects into page context
    };
    // Attempt to get script name from current execution context if possible (difficult)
    // This might be overridden by specific script wrappers if implemented

    if (typeof GM_info === 'undefined') {
        log('Defining GM_info');
        unsafeWindow.GM_info = scriptInfo;
        // Add GM_info to grants list for completeness
        // scriptInfo.script.grants.push('GM_info');
    } else {
        warn('GM_info already defined.');
    }

    // --- Storage APIs (Bridged via window) ---
    // These rely on functions exposed by Playwright's page.exposeFunction on the window object

    if (typeof GM_setValue === 'undefined') {
        log('Defining GM_setValue');
        unsafeWindow.GM_setValue = async (key, value) => {
            if (typeof window.gmSetValueBridge !== 'function') {
                error('GM_setValue bridge (window.gmSetValueBridge) not found. GM_setValue will not be functional.');
                return Promise.reject(new Error('GM_setValue bridge (window.gmSetValueBridge) not found.'));
            }
            if (typeof key !== 'string' || key.length === 0) {
                error('GM_setValue: key must be a non-empty string.');
                return Promise.reject(new Error('GM_setValue: key must be a non-empty string.'));
            }
            try {
                // Ensure value is serializable (basic check)
                JSON.stringify(value); // Throws on circular refs, BigInt, etc.
                await window.gmSetValueBridge(key, value);
                // GM spec indicates it returns a Promise<void>, await handles this implicitly
            } catch (e) {
                error(`GM_setValue Error (key: ${key}):`, e);
                return Promise.reject(e); // Propagate error
            }
        };
        // scriptInfo.script.grants.push('GM_setValue');
    } else {
        warn('GM_setValue already defined.');
    }

    if (typeof GM_getValue === 'undefined') {
        log('Defining GM_getValue');
        unsafeWindow.GM_getValue = async (key, defaultValue) => {
             if (typeof window.gmGetValueBridge !== 'function') {
                error('GM_getValue bridge (window.gmGetValueBridge) not found. GM_getValue will return default value.');
                return Promise.resolve(defaultValue); // Return default if bridge missing
            }
             if (typeof key !== 'string' || key.length === 0) {
                error('GM_getValue: key must be a non-empty string.');
                // GM spec isn't explicit on error for bad key, but rejecting seems reasonable.
                // However, mimicking the old behavior of returning default might be safer for compatibility.
                // Let's stick to rejecting for invalid input.
                return Promise.reject(new Error('GM_getValue: key must be a non-empty string.'));
            }
            try {
                // Bridge function is expected to handle the defaultValue logic if the key isn't found
                return await window.gmGetValueBridge(key, defaultValue); // Returns Promise<any>
            } catch (e) {
                 error(`GM_getValue Error (key: ${key}):`, e);
                 // If the bridge fails, should we return defaultValue?
                 // Let's reject to signal a storage system error.
                 return Promise.reject(e);
            }
        };
        // scriptInfo.script.grants.push('GM_getValue');
    } else {
        warn('GM_getValue already defined.');
    }

    if (typeof GM_deleteValue === 'undefined') {
        log('Defining GM_deleteValue');
        unsafeWindow.GM_deleteValue = async (key) => {
             if (typeof window.gmDeleteValueBridge !== 'function') {
                error('GM_deleteValue bridge (window.gmDeleteValueBridge) not found. GM_deleteValue will not be functional.');
                return Promise.reject(new Error('GM_deleteValue bridge (window.gmDeleteValueBridge) not found.'));
            }
             if (typeof key !== 'string' || key.length === 0) {
                error('GM_deleteValue: key must be a non-empty string.');
                return Promise.reject(new Error('GM_deleteValue: key must be a non-empty string.'));
            }
            try {
                await window.gmDeleteValueBridge(key);
                // Returns Promise<void>
            } catch (e) {
                 error(`GM_deleteValue Error (key: ${key}):`, e);
                 return Promise.reject(e);
            }
        };
        // scriptInfo.script.grants.push('GM_deleteValue');
    } else {
        warn('GM_deleteValue already defined.');
    }

    if (typeof GM_listValues === 'undefined') {
        log('Defining GM_listValues');
        unsafeWindow.GM_listValues = async () => {
            if (typeof window.gmListValuesBridge !== 'function') {
                error('GM_listValues bridge (window.gmListValuesBridge) not found. GM_listValues will return empty array.');
                return Promise.resolve([]); // Return empty array if bridge missing
            }
            try {
                return await window.gmListValuesBridge(); // Returns Promise<string[]>
            } catch (e) {
                 error('GM_listValues Error:', e);
                 return Promise.reject(e);
            }
        };
        // scriptInfo.script.grants.push('GM_listValues');
    } else {
        warn('GM_listValues already defined.');
    }

    // --- Resource APIs ---
    // These require the runner to provide resource content, possibly via another bridge

    if (typeof GM_getResourceText === 'undefined') {
        // Requires a bridge function like GM_getResourceText_bridge(resourceName)
        warn('GM_getResourceText_bridge not found. GM_getResourceText will not be functional.');
        unsafeWindow.GM_getResourceText = (name) => {
            error(`GM_getResourceText("${name}") called, but bridge is not available.`);
            return null; // Or throw error? GM spec says returns string | null
        };
        // scriptInfo.script.grants.push('GM_getResourceText');
    } else {
        warn('GM_getResourceText already defined.');
    }

    if (typeof GM_getResourceURL === 'undefined') {
        // Requires a bridge function like GM_getResourceURL_bridge(resourceName)
        // This bridge would likely return a data: URL with the resource content
        warn('GM_getResourceURL_bridge not found. GM_getResourceURL will not be functional.');
        unsafeWindow.GM_getResourceURL = (name) => {
             error(`GM_getResourceURL("${name}") called, but bridge is not available.`);
             return null; // Or throw error? GM spec says returns string | null
        };
        // scriptInfo.script.grants.push('GM_getResourceURL');
    } else {
        warn('GM_getResourceURL already defined.');
    }

    // --- GM_addStyle ---
    if (typeof GM_addStyle === 'undefined') {
        log('Defining GM_addStyle');
        unsafeWindow.GM_addStyle = (css) => {
            try {
                const style = document.createElement('style');
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
                log('GM_addStyle: Style added to head.');
                return style; // Returns the <style> element
            } catch (e) {
                error('GM_addStyle Error:', e);
                // Return null or throw? Let's return null, similar to resource functions on error.
                return null;
            }
        };
        // scriptInfo.script.grants.push('GM_addStyle');
    } else {
        warn('GM_addStyle already defined.');
    }

    // --- GM_xmlhttpRequest (Bridged) ---
    if (typeof GM_xmlhttpRequest === 'undefined') {
        if (typeof GM_xmlhttpRequest_bridge === 'function') {
            log('Defining GM_xmlhttpRequest');
            const requestMap = new Map();
            let requestIdCounter = 0;

            // Handler for responses coming back from the Node.js bridge
            unsafeWindow.GM_xmlhttpRequest_callback_handler = (requestId, eventName, responseData) => {
                const requestContext = requestMap.get(requestId);
                if (!requestContext) {
                    warn(`Received callback for unknown GM_xmlhttpRequest ID: ${requestId}`);
                    return;
                }

                const callback = requestContext.details[eventName];
                log(`GM_xmlhttpRequest Callback: id=${requestId}, event=${eventName}`);

                // Reconstruct Blob/ArrayBuffer from Base64 if needed
                 if ((responseData._responseType === 'blob' || responseData._responseType === 'arraybuffer') && typeof responseData.response === 'string') {
                    try {
                        const byteString = atob(responseData.response);
                        const byteNumbers = new Array(byteString.length);
                        for (let i = 0; i < byteString.length; i++) {
                            byteNumbers[i] = byteString.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);

                        if (responseData._responseType === 'blob') {
                            const mimeType = responseData._contentType || ''; // Use content type from bridge
                            responseData.response = new Blob([byteArray], { type: mimeType });
                        } else { // arraybuffer
                            responseData.response = byteArray.buffer;
                        }
                         log(`  > Decoded base64 response for ${responseData._responseType}`);
                    } catch (e) {
                        error(`Error decoding base64 response in browser (id: ${requestId}):`, e);
                        // Trigger onerror if decoding fails? Or pass raw base64?
                        // Let's trigger onerror for consistency.
                        const errorCallback = requestContext.details['onerror'];
                        if (typeof errorCallback === 'function') {
                             try {
                                 errorCallback({
                                     ...responseData, // Include original response data
                                     error: `Failed to decode base64 response: ${e.message}`,
                                     status: 0, // Indicate client-side error
                                     statusText: 'Decoding Error'
                                 });
                             } catch (cbError) {
                                 error(`Error executing onerror callback after decoding failure (id: ${requestId}):`, cbError);
                             }
                        }
                        requestMap.delete(requestId); // Clean up failed request
                        return; // Stop processing this callback
                    }
                }

                 // Add responseText if the effective type was text
                 if (responseData._responseType === 'text' && typeof responseData.response === 'string') {
                     responseData.responseText = responseData.response;
                 }


                if (typeof callback === 'function') {
                    try {
                        callback(responseData);
                    } catch (cbError) {
                        error(`Error executing GM_xmlhttpRequest callback (${eventName}, id: ${requestId}):`, cbError);
                    }
                }

                // Clean up on final events
                if (['onload', 'onerror', 'onabort', 'ontimeout'].includes(eventName)) {
                    requestMap.delete(requestId);
                }
            };

            unsafeWindow.GM_xmlhttpRequest = (details) => {
                const requestId = ++requestIdCounter;
                log(`GM_xmlhttpRequest Called: id=${requestId}, method=${details.method}, url=${details.url}`);
                requestMap.set(requestId, { details });

                // Basic validation
                if (!details.url || typeof details.url !== 'string') {
                     error(`GM_xmlhttpRequest (id: ${requestId}): Invalid or missing 'url'.`);
                     // Immediately call onerror
                     if (typeof details.onerror === 'function') {
                         details.onerror({ error: "Invalid or missing 'url'", finalUrl: details.url, status: 0, statusText: 'Invalid Request' });
                     }
                     requestMap.delete(requestId);
                     // GM spec doesn't define return value clearly for immediate error, return dummy abort object?
                     return { abort: () => log(`Abort called on invalid request (id: ${requestId})`) };
                }


                // Send request details to the Node.js bridge
                GM_xmlhttpRequest_bridge(requestId, details)
                    .catch(bridgeError => {
                        // Handle errors during the bridge call itself (e.g., Playwright disconnected)
                        error(`GM_xmlhttpRequest Bridge Error (id: ${requestId}):`, bridgeError);
                        const errorCallback = details.onerror;
                        if (typeof errorCallback === 'function') {
                            try {
                                errorCallback({
                                    error: `Bridge communication error: ${bridgeError.message}`,
                                    finalUrl: details.url,
                                    status: 0,
                                    statusText: 'Bridge Error'
                                });
                            } catch (cbError) {
                                 error(`Error executing onerror callback after bridge failure (id: ${requestId}):`, cbError);
                            }
                        }
                        requestMap.delete(requestId); // Clean up failed request
                    });

                // Return an abort handle
                return {
                    abort: () => {
                        log(`GM_xmlhttpRequest Abort Called: id=${requestId}`);
                        const requestContext = requestMap.get(requestId);
                        if (requestContext) {
                            // Inform the bridge to abort the request if possible
                            // This might require another bridge function like GM_xmlhttpRequest_abort_bridge(requestId)
                            // For now, we just trigger the 'onabort' locally if the bridge hasn't completed yet.
                            // The bridge itself should map AbortError to onabort.
                            warn(`Abort handle used, but requires GM_xmlhttpRequest_abort_bridge for full effect.`);
                            // Optionally, trigger onabort immediately for faster feedback?
                            // GM_xmlhttpRequest_callback_handler(requestId, 'onabort', { finalUrl: requestContext.details.url });
                            // requestMap.delete(requestId); // Remove if triggering locally
                        }
                    }
                };
            };
            // scriptInfo.script.grants.push('GM_xmlhttpRequest');
        } else {
            warn('GM_xmlhttpRequest_bridge not found. GM_xmlhttpRequest will not be functional.');
            unsafeWindow.GM_xmlhttpRequest = () => {
                error('GM_xmlhttpRequest is not available.');
                // Return dummy abort handle
                 return { abort: () => {} };
            };
        }
    } else {
        warn('GM_xmlhttpRequest already defined.');
    }

    // --- Tab and Window APIs (Bridged/Partial) ---

    if (typeof GM_openInTab === 'undefined') {
         if (typeof GM_openInTab_bridge === 'function') {
            log('Defining GM_openInTab');
            unsafeWindow.GM_openInTab = (url, options) => {
                const openInBackground = typeof options === 'boolean' ? options : options?.active === false;
                log(`GM_openInTab: url=${url}, background=${openInBackground}`);
                try {
                    // Call the bridge function
                    GM_openInTab_bridge(url, { active: !openInBackground });
                    // Note: The returned object (with close, closed, onclose) is not easily polyfilled here.
                } catch (e) {
                     error(`GM_openInTab Error (url: ${url}):`, e);
                }
            };
            // scriptInfo.script.grants.push('GM_openInTab');
         } else {
             warn('GM_openInTab_bridge not found. GM_openInTab will not be functional.');
             unsafeWindow.GM_openInTab = (url) => { error(`GM_openInTab(${url}) called, but bridge is not available.`); };
         }
    } else {
        warn('GM_openInTab already defined.');
    }

    // --- Clipboard API (Bridged/Partial) ---

    if (typeof GM_setClipboard === 'undefined') {
         if (typeof GM_setClipboard_bridge === 'function') {
            log('Defining GM_setClipboard');
            // Uses bridge which calls page.evaluate -> navigator.clipboard.writeText
            unsafeWindow.GM_setClipboard = (text, type = 'text') => {
                 log(`GM_setClipboard: type=${type}`);
                 if (type !== 'text') {
                     warn(`GM_setClipboard: type "${type}" is not fully supported, treating as text.`);
                 }
                 try {
                    // Bridge handles the actual clipboard interaction
                    GM_setClipboard_bridge(text, type);
                 } catch (e) {
                      error('GM_setClipboard Error:', e);
                 }
            };
            // scriptInfo.script.grants.push('GM_setClipboard');
         } else {
             warn('GM_setClipboard_bridge not found. GM_setClipboard will not be functional.');
             unsafeWindow.GM_setClipboard = (text) => { error(`GM_setClipboard called, but bridge is not available.`); };
         }
    } else {
        warn('GM_setClipboard already defined.');
    }

    // --- Notification API (Bridged/Partial) ---

    if (typeof GM_notification === 'undefined') {
         if (typeof GM_notification_bridge === 'function') {
            log('Defining GM_notification');
            // Basic bridge just logs, doesn't handle callbacks well
            unsafeWindow.GM_notification = (details, ondone, onclick) => {
                 const text = typeof details === 'string' ? details : details.text;
                 const title = typeof details === 'string' ? 'Userscript Notification' : details.title;
                 log(`GM_notification: title="${title}", text="${text}"`);
                 try {
                     // Call bridge, passing callbacks (though bridge might just ignore them)
                     GM_notification_bridge(details, ondone, onclick);
                 } catch (e) {
                      error('GM_notification Error:', e);
                 }
            };
            // scriptInfo.script.grants.push('GM_notification');
         } else {
             warn('GM_notification_bridge not found. GM_notification will be non-functional (console log only).');
             // Provide a console-logging fallback
             unsafeWindow.GM_notification = (details, ondone) => {
                 const text = typeof details === 'string' ? details : details.text;
                 const title = typeof details === 'string' ? 'Userscript Notification' : details.title || 'Userscript Notification';
                 warn(`GM_notification (Not Supported): Title="${title}", Text="${text}"`);
                 if (ondone) {
                     try { ondone(false); } catch(e) {} // Simulate not shown
                 }
             };
         }
    } else {
        warn('GM_notification already defined.');
    }

    // --- Menu Command API (Storing References) ---

    if (typeof GM_registerMenuCommand === 'undefined') {
        log('Defining GM_registerMenuCommand (Stores reference)');
        unsafeWindow.GM_registerMenuCommand = (caption, commandFunc, accessKey) => {
            if (typeof caption !== 'string' || caption.length === 0) {
                error('GM_registerMenuCommand: caption must be a non-empty string.');
                return null; // Or throw? Let's return null for invalid input.
            }
            if (typeof commandFunc !== 'function') {
                error(`GM_registerMenuCommand("${caption}"): commandFunc must be a function.`);
                return null;
            }
            if (unsafeWindow.__registeredMenuCommands.hasOwnProperty(caption)) {
                warn(`GM_registerMenuCommand: Overwriting existing command with caption "${caption}".`);
            }
            unsafeWindow.__registeredMenuCommands[caption] = commandFunc;
            log(`Registered menu command: "${caption}"`);
            // Return the caption as the ID for simplicity in unregistering
            return caption;
        };
        // scriptInfo.script.grants.push('GM_registerMenuCommand');
    } else {
        warn('GM_registerMenuCommand already defined.');
    }

     if (typeof GM_unregisterMenuCommand === 'undefined') {
        log('Defining GM_unregisterMenuCommand (Uses stored reference)');
        unsafeWindow.GM_unregisterMenuCommand = (caption) => { // Expecting caption as the ID
            if (typeof caption !== 'string' || caption.length === 0) {
                error('GM_unregisterMenuCommand: caption (ID) must be a non-empty string.');
                return;
            }
            if (unsafeWindow.__registeredMenuCommands.hasOwnProperty(caption)) {
                delete unsafeWindow.__registeredMenuCommands[caption];
                log(`Unregistered menu command: "${caption}"`);
            } else {
                warn(`GM_unregisterMenuCommand: Command with caption "${caption}" not found.`);
            }
        };
        // scriptInfo.script.grants.push('GM_unregisterMenuCommand');
    } else {
        warn('GM_unregisterMenuCommand already defined.');
    }

    // --- @downloadURL, @updateURL, @supportURL ---
    // These are metadata keys, not runtime APIs. GM_info exposes them if present.

    // --- GM_log (Deprecated) ---
    // Typically just maps to console.log
    if (typeof GM_log === 'undefined') {
        log('Defining deprecated GM_log (maps to console.log)');
        unsafeWindow.GM_log = console.log;
        // scriptInfo.script.grants.push('GM_log');
    } else {
        warn('GM_log already defined.');
    }

    // --- GM_addValueChangeListener (Requires complex bridging or alternative) ---
    if (typeof GM_addValueChangeListener === 'undefined') {
        warn('Defining GM_addValueChangeListener (Not Supported)');
        unsafeWindow.GM_addValueChangeListener = (key, listener) => {
             warn(`GM_addValueChangeListener for key "${key}" called, but this API is not supported in the Playwright environment.`);
             // Return a dummy ID
             return -1;
        };
        // scriptInfo.script.grants.push('GM_addValueChangeListener');
    } else {
        warn('GM_addValueChangeListener already defined.');
    }

     if (typeof GM_removeValueChangeListener === 'undefined') {
        warn('Defining GM_removeValueChangeListener (Not Supported)');
        unsafeWindow.GM_removeValueChangeListener = (listenerId) => {
             warn(`GM_removeValueChangeListener(${listenerId}) called, but this API is not supported.`);
        };
        // scriptInfo.script.grants.push('GM_removeValueChangeListener');
    } else {
        warn('GM_removeValueChangeListener already defined.');
    }


    log('GM API Polyfill loaded.');

})();