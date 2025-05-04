const { chromium, firefox } = require('playwright'); // Added firefox
const path = require('path');
const fs = require('fs').promises; // Needed for file operations
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const tmp = require('tmp'); // Added tmp for temporary directories
const { loadUserscripts, urlMatches } = require('./userscript-runner');

// --- Configuration via yargs ---
const argv = yargs(hideBin(process.argv))
    .usage('Usage: node $0 [options]')
    .option('url', {
        alias: 'u',
        type: 'string',
        description: 'Target URL to navigate to',
        default: process.env.TARGET_URL || 'https://example.com',
    })
    .option('dir', {
        alias: 'd',
        type: 'string',
        description: 'Directory containing userscripts',
        default: process.env.USERSCRIPTS_DIR || './userscripts', // Default relative to execution dir
    })
    .option('polyfill', {
        alias: 'p',
        type: 'string',
        description: 'Path to the GM API polyfill script',
        default: path.resolve(__dirname, './polyfills/gm-api-polyfill.js'), // Default relative to main.js
    })
    .option('headless', {
        alias: 'h',
        type: 'boolean',
        description: 'Run browser in headless mode',
        default: process.env.HEADLESS === 'true',
    })
    .option('timeout', {
        alias: 't',
        type: 'number',
        description: 'Time (ms) to keep the browser open after navigation',
        default: parseInt(process.env.BROWSER_TIMEOUT || '60000', 10),
    })
    .option('run-menu-command', { // Added option
        alias: 'm',
        type: 'string',
        description: 'Caption of the GM menu command to execute after page load.',
        default: null,
    })
    .option('intercept-network', { // Added network interception option
        alias: 'i',
        type: 'boolean',
        description: 'Enable network request interception and logging.',
        default: false,
    })
    .option('storage-path', { // Added storage path option
        alias: 's',
        type: 'string',
        description: 'Path to the JSON file for persistent GM storage.',
        default: 'gm_values.json', // Default relative to project root
    })
    .option('extensions', { // Added extensions option
        alias: 'e',
        type: 'string',
        description: 'Comma-separated paths to unpacked browser extensions to load.',
        default: null,
    })
    .option('browser', { // Added browser selection option
        alias: 'b',
        type: 'string',
        description: 'Browser to use (chromium or firefox)',
        choices: ['chromium', 'firefox'], // Enforce choices
        default: 'chromium',
    })
    .help()
    .alias('help', '?')
    .argv;

const targetUrl = argv.url;
const userscriptsDir = path.resolve(argv.dir); // Resolve to absolute path
const polyfillPath = path.resolve(argv.polyfill); // Resolve to absolute path
const headlessMode = argv.headless;
const browserTimeout = argv.timeout;
const menuCommandToRun = argv.runMenuCommand; // Store the command caption
const interceptNetwork = argv.interceptNetwork; // Store the intercept flag
const storageFilePath = path.resolve(argv.storagePath); // Resolve storage path
const extensionPathsArg = argv.extensions; // Store extensions paths string
const browserType = argv.browser; // Store selected browser type

// --- Main Execution ---
(async () => {
    let browser = null; // Initialize browser to null
    let context = null;
    let page = null;
    let gmStorage = {}; // In-memory storage for GM values
    let tempDirCleanup = null; // Function to clean up temp directory for Firefox profile

    // --- Load Persistent Storage ---
    console.log(`Attempting to load GM storage from: ${storageFilePath}`);
    try {
        const data = await fs.readFile(storageFilePath, 'utf8');
        gmStorage = JSON.parse(data);
        console.log(`Successfully loaded GM storage from ${storageFilePath}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`Storage file ${storageFilePath} not found. Starting with empty storage (this is normal on first run).`);
            gmStorage = {}; // Ensure it's empty if file not found
        } else if (error instanceof SyntaxError) {
            console.error(`Error parsing JSON from storage file ${storageFilePath}. Starting with empty storage.`, error);
            gmStorage = {}; // Reset on parse error
        } else {
            console.error(`Error reading storage file ${storageFilePath}. Starting with empty storage.`, error);
            gmStorage = {}; // Reset on other read errors
        }
    }

    // --- Function to Save Storage ---
    const saveGmStorage = async () => {
        console.log(`Saving GM storage to: ${storageFilePath}`);
        try {
            await fs.writeFile(storageFilePath, JSON.stringify(gmStorage, null, 2), 'utf8');
            console.log(`Successfully saved GM storage to ${storageFilePath}`);
        } catch (error) {
            console.error(`Error writing GM storage file ${storageFilePath}:`, error);
        }
    };


    try {
        console.log(`Selected browser: ${browserType}`);
        console.log(`Launching browser (Headless: ${headlessMode})...`);

        let resolvedExtensionPaths = [];
        if (extensionPathsArg) {
            resolvedExtensionPaths = extensionPathsArg.split(',')
                .map(p => p.trim())
                .filter(p => p) // Remove empty strings
                .map(p => path.resolve(p)); // Resolve to absolute paths
            if (resolvedExtensionPaths.length > 0) {
                 console.log(`Attempting to load extensions: ${resolvedExtensionPaths.join(', ')}`);
            }
        }

        // --- Browser Launch Logic ---
        if (browserType === 'chromium') {
            const launchOptions = {
                headless: headlessMode,
                args: [], // Initialize args array
            };

            if (resolvedExtensionPaths.length > 0) {
                launchOptions.args.push(`--load-extension=${resolvedExtensionPaths.join(',')}`);
                if (headlessMode) {
                    console.warn("Chromium: Loading extensions in headless mode might have limitations.");
                }
            }
            browser = await chromium.launch(launchOptions);
            console.log('Creating new Chromium browser context...');
            context = await browser.newContext();

        } else if (browserType === 'firefox') {
            if (resolvedExtensionPaths.length > 0) {
                // Firefox requires a persistent context with a profile to load extensions
                console.log("Firefox: Extensions require launching a persistent context with a temporary profile.");
                tmp.setGracefulCleanup(); // Clean up temp files on exit
                const tempDir = tmp.dirSync({ unsafeCleanup: true }); // Create temp dir
                const userDataDir = tempDir.name;
                tempDirCleanup = tempDir.removeCallback; // Store cleanup function
                console.log(`Firefox: Created temporary profile directory: ${userDataDir}`);

                const launchOptions = {
                    headless: headlessMode,
                    args: resolvedExtensionPaths.map(p => `--install-temporary-addon="${p}"`), // Quote paths for safety
                    userDataDir: userDataDir,
                };

                console.log('Launching Firefox persistent context...');
                context = await firefox.launchPersistentContext(userDataDir, launchOptions);
                browser = null; // launchPersistentContext doesn't return a separate browser instance
                console.log('Firefox persistent context created.');

            } else {
                // Firefox without extensions
                console.log('Launching Firefox browser...');
                browser = await firefox.launch({ headless: headlessMode });
                console.log('Creating new Firefox browser context...');
                context = await browser.newContext();
            }
        } else {
            // Should not happen due to yargs choices, but good practice
            console.error(`Invalid browser type specified: ${browserType}. Exiting.`);
            process.exit(1);
        }

        // --- Page Creation (common to all paths where context is created) ---
        if (!context) {
             console.error("Failed to create browser context. Exiting.");
             process.exit(1);
        }
        console.log('Creating new page...');
        page = await context.newPage();


        // --- GM API Bridge Implementation (Node.js side) ---
        console.log('Setting up GM API bridge functions (with persistent storage)...');

        // Expose bridge functions - wrap in try/catch for robustness
        try {
            // --- Persistent Storage Bridge Functions ---
            await page.exposeFunction('gmSetValueBridge', async (key, value) => {
                console.log(`[Bridge] gmSetValueBridge: key=${key}`);
                gmStorage[key] = value;
                await saveGmStorage(); // Persist change
            });

            await page.exposeFunction('gmGetValueBridge', async (key, defaultValue) => {
                console.log(`[Bridge] gmGetValueBridge: key=${key}, default=${defaultValue}`);
                // Return the value or the defaultValue if the key doesn't exist
                return gmStorage.hasOwnProperty(key) ? gmStorage[key] : defaultValue;
            });

            await page.exposeFunction('gmDeleteValueBridge', async (key) => {
                console.log(`[Bridge] gmDeleteValueBridge: key=${key}`);
                if (gmStorage.hasOwnProperty(key)) {
                    delete gmStorage[key];
                    await saveGmStorage(); // Persist change
                }
            });

            await page.exposeFunction('gmListValuesBridge', async () => {
                console.log('[Bridge] gmListValuesBridge');
                return Object.keys(gmStorage);
            });

            // --- Other GM Bridge Functions ---

            // GM_xmlhttpRequest bridge using Node's fetch
            await page.exposeFunction('GM_xmlhttpRequest_bridge', async (requestId, details) => {
                console.log(`[Bridge] GM_xmlhttpRequest: id=${requestId}, method=${details.method}, url=${details.url}`);
                const { method, url, headers, data, timeout, responseType, user, password, overrideMimeType } = details;
                const controller = new AbortController();
                const signal = controller.signal;
                let timeoutId = null; // Initialize timeoutId to null

                // Helper to send callbacks safely
                const sendCallback = async (eventName, responseData) => {
                    try {
                        // Check if page is still available before evaluating
                        if (!page.isClosed()) {
                            await page.evaluate(({ requestId, eventName, responseData }) => {
                                if (window.GM_xmlhttpRequest_callback_handler) {
                                    window.GM_xmlhttpRequest_callback_handler(requestId, eventName, responseData);
                                }
                            }, { requestId, eventName, responseData });
                        } else {
                             console.warn(`[Bridge] Page closed before sending GM_xmlhttpRequest callback (${eventName}) for id=${requestId}`);
                        }
                    } catch (evalError) {
                        // Ignore errors if page is closed during callback
                        if (!evalError.message.includes('Target page, context or browser has been closed')) {
                            console.error(`[Bridge] Error sending GM_xmlhttpRequest callback (${eventName}):`, evalError);
                        }
                    }
                };

                if (timeout) {
                    timeoutId = setTimeout(() => {
                        console.warn(`[Bridge] GM_xmlhttpRequest TIMEOUT: id=${requestId}, url=${url}`);
                        controller.abort(); // Abort the fetch request
                        // Send ontimeout event
                        sendCallback('ontimeout', {
                            status: 0, statusText: 'Timeout', finalUrl: url, error: 'Request timed out'
                        });
                    }, timeout);
                }

                try {
                    const fetchOptions = {
                        method: method || 'GET', // Default to GET
                        headers: headers || {},
                        body: data,
                        signal: signal,
                        redirect: 'follow' // Default behavior
                    };

                    if (user && password) {
                        fetchOptions.headers['Authorization'] = 'Basic ' + Buffer.from(user + ":" + password).toString('base64');
                    }

                    const response = await fetch(url, fetchOptions);
                    if (timeoutId) clearTimeout(timeoutId); // Clear timeout on successful response

                    // Determine response processing based on responseType
                    let responseBody;
                    const contentTypeHeader = response.headers.get('content-type') || '';
                    // Use overrideMimeType if provided
                    const effectiveContentType = overrideMimeType || contentTypeHeader;

                    // Default to 'text' if responseType is not specified or invalid
                    let effectiveResponseType = ['json', 'text', 'arraybuffer', 'blob'].includes(responseType) ? responseType : 'text';
                    // Guess 'json' from effective content-type if responseType wasn't explicitly set
                    if (!responseType && effectiveContentType.includes('json')) {
                        effectiveResponseType = 'json';
                    }

                    try {
                        switch (effectiveResponseType) {
                            case 'json':
                                responseBody = await response.json();
                                break;
                            case 'blob':
                            case 'arraybuffer':
                                // Send as Base64, browser polyfill reconstructs
                                const buffer = await response.arrayBuffer();
                                responseBody = Buffer.from(buffer).toString('base64');
                                break;
                            case 'text':
                            default:
                                responseBody = await response.text();
                                effectiveResponseType = 'text'; // Ensure it's marked as text
                                break;
                        }
                    } catch (bodyError) {
                        console.error(`[Bridge] GM_xmlhttpRequest Error reading response body as ${effectiveResponseType}:`, bodyError);
                        throw new Error(`Failed to read response body as ${effectiveResponseType}: ${bodyError.message}`);
                    }

                    const gmResponse = {
                        status: response.status,
                        statusText: response.statusText,
                        responseHeaders: Object.fromEntries(response.headers.entries()),
                        finalUrl: response.url,
                        response: responseBody, // Processed body (might be base64)
                        _responseType: effectiveResponseType, // Type used for processing
                        _contentType: effectiveContentType, // Pass content type for blob reconstruction
                        readyState: 4, // Simulate completion
                        responseText: effectiveResponseType === 'text' ? responseBody : undefined, // Add responseText if applicable
                        // responseXML: Not polyfilled
                    };

                    // Send onload event
                    await sendCallback('onload', gmResponse);

                } catch (error) {
                    if (timeoutId) clearTimeout(timeoutId); // Clear timeout on error
                    // Avoid logging error if it's just an abort after timeout/manual abort
                    if (error.name !== 'AbortError') {
                        console.error(`[Bridge] GM_xmlhttpRequest ERROR: id=${requestId}, url=${url}`, error.message);
                    }

                    const isAbort = error.name === 'AbortError';
                    // Map AbortError to onabort, other errors to onerror
                    const eventName = isAbort ? 'onabort' : 'onerror';

                    // Send onerror or onabort event
                    await sendCallback(eventName, {
                        status: 0,
                        statusText: isAbort ? 'Aborted' : 'Network Error',
                        finalUrl: url,
                        error: error.message,
                    });
                }
            });

            // Add other GM bridge functions here (GM_notification, GM_openInTab, etc.)
            // Example: GM_openInTab
            await page.exposeFunction('GM_openInTab_bridge', async (url, options) => {
                console.log(`[Bridge] GM_openInTab: url=${url}, options=`, options);
                try {
                    if (context) { // Ensure context exists
                        const newPage = await context.newPage(); // Use the existing context
                        await newPage.goto(url);
                        if (!(options?.active)) {
                            // Bring the original page back to front if the new tab shouldn't be active
                            if (page && !page.isClosed()) await page.bringToFront();
                        }
                    } else {
                         console.error("[Bridge] Cannot GM_openInTab: Browser context does not exist.");
                    }
                    // Note: loadInBackground is deprecated/complex, active=false is preferred
                } catch (tabError) {
                    console.error(`[Bridge] Error opening tab for ${url}:`, tabError);
                }
            });

             // Example: GM_setClipboard
             await page.exposeFunction('GM_setClipboard_bridge', async (text, type) => {
                 console.log(`[Bridge] GM_setClipboard: type=${type}`);
                 try {
                     if (page && !page.isClosed()) {
                         await page.evaluate(async ({ text }) => {
                             try {
                                 await navigator.clipboard.writeText(text);
                             } catch (clipError) {
                                  console.error('GM_setClipboard (browser-side) error:', clipError);
                                  // Optionally re-throw or handle
                             }
                         }, { text });
                     } else {
                          console.error("[Bridge] Cannot GM_setClipboard: Page does not exist or is closed.");
                     }
                 } catch (clipError) {
                     console.error(`[Bridge] Error setting clipboard:`, clipError);
                 }
             });

             // Example: GM_notification (basic console log version)
             await page.exposeFunction('GM_notification_bridge', async (details, ondone, onclick) => {
                 const text = typeof details === 'string' ? details : details.text;
                 const title = typeof details === 'string' ? 'Userscript Notification' : details.title || 'Userscript Notification';
                 console.log(`[Bridge] GM_notification: Title="${title}", Text="${text}"`);
                 // Basic simulation: Log and immediately call ondone if provided
                 // A full implementation would require OS-level notifications.
                 if (ondone) {
                     // Callbacks exposed from browser need careful handling or separate bridge
                     console.warn("[Bridge] GM_notification: ondone callback not fully supported in this basic polyfill.");
                 }
                 if (onclick) {
                      console.warn("[Bridge] GM_notification: onclick callback not fully supported in this basic polyfill.");
                 }
             });


        } catch (exposeError) {
            console.error('Fatal Error setting up GM API bridge:', exposeError);
            throw exposeError; // Propagate error
        }

        // --- Load Userscripts ---
        console.log(`Loading userscripts from: ${userscriptsDir}`);
        const allUserscripts = await loadUserscripts(userscriptsDir); // loadUserscripts handles its own errors/logging

        // --- Inject Polyfill ---
        try {
            // Check if polyfill file exists before trying to inject
            await fs.access(polyfillPath, fs.constants.R_OK); // Check read access
            console.log(`Injecting GM API Polyfill: ${polyfillPath}`);
            // Inject polyfill first using addInitScript
            await page.addInitScript({ path: polyfillPath });
        } catch (polyfillError) {
            if (polyfillError.code === 'ENOENT') {
                console.warn(`Polyfill file not found at ${polyfillPath}. Skipping polyfill injection.`);
            } else if (polyfillError.code === 'EACCES') {
                 console.warn(`Permission denied reading polyfill file at ${polyfillPath}. Skipping polyfill injection.`);
            } else {
                console.error(`Error accessing or injecting polyfill from ${polyfillPath}:`, polyfillError);
                // Decide if this is fatal; for now, we'll continue without the polyfill
            }
        }

        // --- Prepare Script Injection based on runAt ---
        const scriptsToInject = {
            'document-start': [],
            'document-end': [],
            'document-idle': [],
        };

        if (allUserscripts.length > 0) {
            console.log(`Checking ${allUserscripts.length} loaded scripts against URL: ${targetUrl}`);
            for (const script of allUserscripts) {
                if (urlMatches(script.matchPatterns, targetUrl)) {
                    if (scriptsToInject[script.runAt]) {
                        console.log(`  - Scheduling "${script.name}" for ${script.runAt}`);
                        scriptsToInject[script.runAt].push(script);
                    } else {
                        // This case should ideally be handled by parseMetadata defaulting
                        console.warn(`Script "${script.name}" has unknown runAt value "${script.runAt}". Skipping.`);
                    }
                } else {
                    // console.log(`  - Skipping "${script.name}" (no match)`); // Optional verbose logging
                }
            }
        } else {
             console.log('No userscripts were loaded, skipping matching.');
        }


        // --- Inject document-start scripts ---
        if (scriptsToInject['document-start'].length > 0) {
            console.log(`Injecting ${scriptsToInject['document-start'].length} document-start scripts...`);
            for (const script of scriptsToInject['document-start']) {
                try {
                    console.log(`  - Adding init script: ${script.name}`);
                    await page.addInitScript({ content: script.content });
                } catch (initScriptError) {
                    console.error(`Error adding init script ${script.name}:`, initScriptError);
                }
            }
        }

        // --- Set up listeners for document-end and document-idle ---
        page.on('domcontentloaded', async () => {
            console.log('Event: domcontentloaded');
            if (scriptsToInject['document-end'].length > 0) {
                 console.log(`Injecting ${scriptsToInject['document-end'].length} document-end scripts...`);
                 for (const script of scriptsToInject['document-end']) {
                    try {
                        console.log(`  - Evaluating script: ${script.name}`);
                        if (!page.isClosed()) await page.evaluate(script.content);
                    } catch (evalError) {
                        // Avoid crashing if one script fails
                         if (!page.isClosed()) { // Don't log error if page closed during eval
                            console.error(`Error evaluating script "${script.name}" at document-end:`, evalError);
                         }
                    }
                 }
            }
        });

        page.on('load', async () => {
            console.log('Event: load');
             if (scriptsToInject['document-idle'].length > 0) {
                 console.log(`Injecting ${scriptsToInject['document-idle'].length} document-idle scripts...`);
                 for (const script of scriptsToInject['document-idle']) {
                    try {
                        console.log(`  - Evaluating script: ${script.name}`);
                         if (!page.isClosed()) await page.evaluate(script.content);
                    } catch (evalError) {
                         // Avoid crashing if one script fails
                         if (!page.isClosed()) { // Don't log error if page closed during eval
                            console.error(`Error evaluating script "${script.name}" at document-idle:`, evalError);
                         }
                    }
                 }
             }
        });

        // Add listener for page errors
        page.on('pageerror', (error) => {
            // Ignore common benign errors if necessary
            // if (error.message.includes('some benign error')) return;
            console.error('Unhandled page error:', error);
        });
        page.on('console', msg => {
            // Forward browser console messages to Node console
            const type = msg.type();
            const text = msg.text();
            // Avoid logging the noisy "Download is starting" message from Playwright itself
            if (text.includes('Download is starting') && text.includes('Save as')) return;

            // Map browser console types to Node console methods
            const logFunc = {
                log: console.log,
                warning: console.warn,
                error: console.error,
                info: console.info,
                debug: console.debug,
                assert: console.assert,
                // Add others if needed (dir, table, etc.)
            }[type] || console.log; // Default to console.log

            logFunc(`[Browser Console] ${text}`);
        });


        // --- Network Interception (if enabled) ---
        if (interceptNetwork) {
            console.log('[Network] Interception enabled. Setting up routing...');
            try {
                await page.route('**', route => {
                    const request = route.request();
                    console.log(`[Network] Request: ${request.resourceType()} ${request.url()}`);
                    // Allow the request to continue
                    route.continue();
                });
                console.log('[Network] Routing setup complete.');
            } catch (routeError) {
                console.error('[Network] Error setting up request interception:', routeError);
                // Decide if this is fatal; for now, we'll just log it.
            }
        }

        // --- Navigate ---
        console.log(`Navigating to: ${targetUrl}`);
        // Use 'load' to ensure idle scripts run after all resources
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 }); // Add navigation timeout

        console.log(`Navigation complete. Page title: "${await page.title()}"`);

        // --- Execute Menu Command if specified ---
        if (menuCommandToRun) {
            console.log(`Attempting to execute menu command via --run-menu-command: "${menuCommandToRun}"`);
            // Add a small delay to allow scripts to potentially register commands after load
            await page.waitForTimeout(1500); // 1.5 seconds delay

            // --- Add Dialog Listener specifically for "Set NZBgeek API Key" ---
            if (menuCommandToRun === "Set NZBgeek API Key") {
                console.log(`[Dialog Setup] Adding 'once' listener for prompt dialog.`);
                page.once('dialog', async dialog => {
                    console.log(`[Dialog Handler] Detected dialog: Type=${dialog.type()}, Message="${dialog.message()}"`);
                    if (dialog.type() === 'prompt') {
                        const apiKey = 'CuJU1bkXcsvYmuXjpK9HtyjTimWw8Zm0';
                        console.log(`[Dialog Handler] Prompt detected. Accepting with API key: ${apiKey}`);
                        try {
                            await dialog.accept(apiKey);
                            console.log('[Dialog Handler] Prompt accepted.');
                        } catch (acceptError) {
                             if (!page.isClosed()) { // Avoid error if page closed during accept
                                console.error('[Dialog Handler] Error accepting prompt:', acceptError);
                             }
                        }
                    } else {
                        console.log(`[Dialog Handler] Non-prompt dialog (${dialog.type()}) detected. Dismissing.`);
                        try {
                            await dialog.dismiss();
                        } catch (dismissError) {
                             if (!page.isClosed()) { // Avoid error if page closed during dismiss
                                console.error('[Dialog Handler] Error dismissing dialog:', dismissError);
                             }
                        }
                    }
                });
            }
            // --- End Dialog Listener ---

            try {
                await page.evaluate(async (commandCaption) => {
                    console.log(`[Browser] Attempting to execute menu command: "${commandCaption}"`);
                    if (window.__registeredMenuCommands && typeof window.__registeredMenuCommands === 'object') {
                        const commandFunction = window.__registeredMenuCommands[commandCaption];
                        if (typeof commandFunction === 'function') {
                            try {
                                console.log(`[Browser] Found command "${commandCaption}". Executing...`);
                                // Check if it's an async function or returns a promise
                                const result = commandFunction();
                                if (result && typeof result.then === 'function') {
                                    await result; // Wait if it's a promise
                                }
                                console.log(`[Browser] Successfully executed menu command: "${commandCaption}"`);
                            } catch (execError) {
                                console.error(`[Browser] Error executing menu command "${commandCaption}":`, execError);
                            }
                        } else {
                            console.error(`[Browser] Menu command "${commandCaption}" not found or is not a function.`);
                        }
                    } else {
                        console.error('[Browser] window.__registeredMenuCommands not found or is not an object.');
                    }
                }, menuCommandToRun); // Pass the command caption to evaluate
            } catch (evalError) {
                // Avoid logging error if page closed during evaluation
                if (!page.isClosed() && !evalError.message.includes('Target page, context or browser has been closed')) {
                    console.error(`[Node.js] Error during page.evaluate for menu command "${menuCommandToRun}":`, evalError);
                }
            }
        }

        console.log(`Keeping browser open for ${browserTimeout / 1000} seconds... (Press Ctrl+C to exit early)`);
        await page.waitForTimeout(browserTimeout); // Keep page open

    } catch (error) {
        console.error('An error occurred during Playwright execution:', error);
        // Log specific errors if needed
        if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
            console.error(`Failed to resolve hostname for URL: ${targetUrl}`);
        } else if (error.message.includes('Navigation timeout')) {
             console.error(`Navigation to ${targetUrl} timed out.`);
        }
        // Ensure browser is closed even if setup failed partially
    } finally {
        // Ensure storage is saved one last time before closing, unless an error occurred very early
        if (page && !page.isClosed()) {
             await saveGmStorage(); // Final save before closing
        } else if (Object.keys(gmStorage).length > 0 && !browser) {
            // If browser launch failed but we loaded storage, try saving anyway
            await saveGmStorage();
        }

        // Close context first (important for persistent context)
        if (context && typeof context.close === 'function') {
            console.log('Closing browser context...');
            try {
                await context.close();
            } catch (closeError) {
                 // Ignore errors if page/context was already closed
                 if (!closeError.message.includes('Target page, context or browser has been closed')) {
                    console.error('Error closing context:', closeError);
                 }
            }
        }

        // Close browser if it exists (won't exist for Firefox persistent context)
        if (browser && typeof browser.close === 'function') {
            console.log('Closing browser...');
            try {
                await browser.close();
            } catch (closeError) {
                 // Ignore errors if browser was already closed
                 if (!closeError.message.includes('Target page, context or browser has been closed')) {
                    console.error('Error closing browser:', closeError);
                 }
            }
        }

        // Clean up temporary Firefox profile directory if created
        if (tempDirCleanup) {
            console.log('Cleaning up temporary Firefox profile directory...');
            try {
                tempDirCleanup();
                console.log('Temporary directory cleaned up.');
            } catch (cleanupError) {
                console.error('Error cleaning up temporary directory:', cleanupError);
            }
        }

        console.log('Execution finished.');
    }
})();