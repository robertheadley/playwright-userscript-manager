# Playwright Userscript Manager

## Project Overview

This project provides a Node.js-based runner that executes userscripts within a Playwright-controlled browser instance (Chromium or Firefox). It aims to replicate a significant portion of the Greasemonkey/Tampermonkey environment, allowing for testing and running userscripts in an automated fashion. Key capabilities include support for common GM\_ functions, persistent storage, network request interception, execution of registered menu commands, and loading browser extensions.

## Features

*   Runs userscripts matching specified URLs in Playwright.
*   Supports Chromium and Firefox browsers.
*   Provides implementations for common Greasemonkey API functions (GM\_*).
*   Persistent storage for `GM_setValue`/`GM_getValue` using a JSON file (`gm_values.json` by default).
*   Intercepts and logs network requests.
*   Executes userscript-registered menu commands via CLI.
*   Loads unpacked browser extensions.
*   Configurable via command-line arguments.
*   Supports basic userscript metadata (`@name`, `@match`, `@run-at`).
*   Applies polyfills for enhanced compatibility.

## Installation

Ensure you have Node.js installed. Then, install the necessary dependencies:

```bash
npm install playwright yargs tmp
```

*(Note: `tmp` might be needed depending on specific polyfill or userscript requirements, include if necessary based on `main.js` dependencies not shown)*

## Dependencies

*   **Playwright:** ([NPM](https://www.npmjs.com/package/playwright), [GitHub](https://github.com/microsoft/playwright)) - Browser automation library.
*   **yargs:** ([NPM](https://www.npmjs.com/package/yargs), [GitHub](https://github.com/yargs/yargs)) - Command-line argument parser.
*   **tmp:** ([NPM](https://www.npmjs.com/package/tmp), [GitHub](https://github.com/raszi/node-tmp)) - Temporary file and directory creation.
## Usage

Run the manager using Node.js, providing the target URL and the directory containing your userscripts.

```bash
node main.js --url <target-url> --dir <userscripts-directory> [options]
```

**Command-Line Options:**

*   `--url`, `-u`: (Required) The URL to navigate to and run userscripts against.
*   `--dir`, `-d`: (Required) The directory containing the userscripts to load. Defaults to `./userscripts`.
*   `--polyfill`, `-p`: Path to a JavaScript polyfill file to inject before userscripts. Defaults to `./polyfill.js`.
*   `--headless`, `-h`: Run the browser in headless mode (no UI). Defaults to `false`.
*   `--timeout`, `-t`: Navigation timeout in milliseconds. Defaults to `30000`.
*   `--run-menu-command`, `-m`: The name of a registered menu command to execute after the page loads.
*   `--intercept-network`, `-i`: Enable network request interception and logging. Defaults to `false`.
*   `--storage-path`, `-s`: Path to the JSON file for persistent GM\_ storage. Defaults to `./gm_values.json`.
*   `--extensions`, `-e`: Comma-separated list of paths to unpacked browser extensions to load.
*   `--browser`, `-b`: Browser to use ('chromium' or 'firefox'). Defaults to 'chromium'.

**Examples:**

1.  Run userscripts from the default `userscripts/` directory on `example.com`:
    ```bash
    node main.js -u https://example.com
    ```

2.  Run userscripts from a specific directory (`my-scripts/`) on `google.com` in headless mode using Firefox, and load an extension:
    ```bash
    node main.js --url https://google.com --dir ./my-scripts --headless --browser firefox --extensions ./path/to/my-extension
    ```

3.  Run userscripts on `test.page`, intercept network requests, use a custom storage file, and execute the 'My Command' menu item:
    ```bash
    node main.js -u http://test.page -i -s ./data/storage.json -m "My Command"
    ```

## Userscript Development

*   **Location:** Place your userscript files (ending in `.user.js`) inside the directory specified by the `--dir` option (`userscripts/` by default).
*   **Metadata:** The runner recognizes the following metadata blocks:
    *   `@name`: The name of the script (currently informational).
    *   `@match`: URL match patterns. The script will run on pages whose URLs match these patterns. Uses simple glob-like matching (e.g., `*://*.example.com/*`). Multiple `@match` lines are allowed.
    *   `@run-at`: Specifies when the script should run relative to the page load.
        *   `document-start`: Injects as early as possible.
        *   `document-end`: Injects after the DOM is loaded, but before resources like images.
        *   `document-idle`: (Default) Injects after the `document-end` event and the page seems idle.
*   **@match Patterns:** Define where your script should execute.
    *   `*` matches any sequence of characters.
    *   Example: `*://github.com/*` matches all GitHub pages (HTTP and HTTPS).
    *   Example: `https://*.google.com/search*` matches Google search result pages.

## Supported Greasemonkey API Functions

The following GM\_ functions are bridged and available within userscripts:

1.  **`GM_setValue(name, value)`**
    *   **Purpose:** Persistently stores a `value` associated with a `name`. The value can be any JSON-serializable type (string, number, boolean, array, simple object). Storage is backed by the file specified via `--storage-path`.
    *   **Signature:** `GM_setValue(name: string, value: any): Promise<void>`
    *   **Examples:**
        ```javascript
        // Example 1: Store a user preference
        GM_setValue('userTheme', 'dark').then(() => {
          console.log('Theme preference saved.');
        });

        // Example 2: Store configuration settings
        const settings = { fontSize: 12, showTooltips: true };
        GM_setValue('pluginSettings', settings); // Can often omit .then() if not waiting
        ```

2.  **`GM_getValue(name, defaultValue)`**
    *   **Purpose:** Retrieves a previously stored value associated with `name`. If the `name` is not found, `defaultValue` is returned.
    *   **Signature:** `GM_getValue(name: string, defaultValue?: any): Promise<any>`
    *   **Examples:**
        ```javascript
        // Example 1: Retrieve a theme, defaulting to 'light'
        GM_getValue('userTheme', 'light').then(theme => {
          document.body.classList.add(`theme-${theme}`);
        });

        // Example 2: Get settings, providing a default object
        const defaultSettings = { fontSize: 10, showTooltips: false };
        GM_getValue('pluginSettings', defaultSettings).then(settings => {
          console.log('Current font size:', settings.fontSize);
        });
        ```

3.  **`GM_deleteValue(name)`**
    *   **Purpose:** Removes a previously stored value associated with `name` from persistent storage.
    *   **Signature:** `GM_deleteValue(name: string): Promise<void>`
    *   **Examples:**
        ```javascript
        // Example 1: Delete a specific setting
        GM_deleteValue('userTheme').then(() => {
          console.log('Theme preference deleted.');
        });

        // Example 2: Clear temporary data
        GM_deleteValue('tempSessionData');
        ```

4.  **`GM_listValues()`**
    *   **Purpose:** Retrieves an array of all names (keys) currently stored in the persistent storage.
    *   **Signature:** `GM_listValues(): Promise<string[]>`
    *   **Examples:**
        ```javascript
        // Example 1: Log all stored keys
        GM_listValues().then(keys => {
          console.log('Stored keys:', keys);
        });

        // Example 2: Check if a specific key exists
        GM_listValues().then(keys => {
          if (keys.includes('pluginSettings')) {
            console.log('Plugin settings exist.');
          }
        });
        ```

5.  **`GM_xmlhttpRequest(details)`**
    *   **Purpose:** Performs an asynchronous HTTP request (XHR). This allows userscripts to fetch data from or send data to other servers, bypassing standard same-origin policy restrictions.
    *   **Signature:** `GM_xmlhttpRequest(details: object): Promise<object>` (The returned Promise resolves with a response object).
    *   **Details Object Properties:** `method`, `url`, `headers`, `data`, `timeout`, `responseType`, `onload`, `onerror`, `ontimeout`, etc. (Refer to Greasemonkey documentation for full details). The implementation bridges common properties.
    *   **Response Object Properties:** `status`, `statusText`, `responseText`, `responseHeaders`, `finalUrl`, etc.
    *   **Examples:**
        ```javascript
        // Example 1: Fetch JSON data using GET
        GM_xmlhttpRequest({
          method: "GET",
          url: "https://api.example.com/data",
          responseType: "json", // Automatically parses JSON response
          onload: function(response) {
            if (response.status === 200) {
              console.log("Received data:", response.response); // Access parsed JSON
            } else {
              console.error("Request failed:", response.statusText);
            }
          },
          onerror: function(error) {
            console.error("Network error:", error);
          }
        });

        // Example 2: Send data using POST
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://api.example.com/submit",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ name: "Test User", value: 123 }),
          onload: function(response) {
            console.log("Server response:", response.responseText);
          }
        });
        ```

6.  **`GM_openInTab(url, options)`**
    *   **Purpose:** Opens a new browser tab with the specified `url`.
    *   **Signature:** `GM_openInTab(url: string, options?: object | boolean): Promise<void>`
    *   **Options:** Can be a boolean (`true` for active, `false` for background) or an object `{ active?: boolean, insert?: boolean, setParent?: boolean }`. `active: true` makes the new tab focused.
    *   **Examples:**
        ```javascript
        // Example 1: Open a link in a new active tab
        GM_openInTab("https://www.google.com", true);

        // Example 2: Open a documentation link in a background tab
        GM_openInTab("https://wiki.greasespot.net/GM_openInTab", { active: false });
        ```

7.  **`GM_setClipboard(data, info)`**
    *   **Purpose:** Copies the given `data` to the system clipboard.
    *   **Signature:** `GM_setClipboard(data: string, info?: string | { type?: string, mimetype?: string }): Promise<void>`
    *   **Info:** Can be a simple string representing the type (e.g., 'text') or an object specifying type/mimetype. The runner primarily supports text copying.
    *   **Examples:**
        ```javascript
        // Example 1: Copy selected text
        const selectedText = window.getSelection().toString();
        if (selectedText) {
          GM_setClipboard(selectedText, 'text');
          console.log('Selected text copied to clipboard.');
        }

        // Example 2: Copy a specific URL
        GM_setClipboard(document.location.href); // 'info' is optional for text
        ```

8.  **`GM_notification(text, title, image, onclick)`**
    *   **Purpose:** Displays a system notification. *Note: The current implementation logs to the console instead of showing a native OS notification.*
    *   **Signature:** `GM_notification(text: string, title?: string, image?: string, onclick?: Function): Promise<void>`
    *   **Examples:**
        ```javascript
        // Example 1: Show a simple notification message
        GM_notification("Userscript finished processing the page.", "Script Complete");

        // Example 2: Notify about an update (will log to console)
        GM_notification("A new version of the script is available.", "Update Check");
        ```

9.  **`GM_registerMenuCommand(name, callback)`**
    *   **Purpose:** Registers a command in the userscript menu. These commands can be triggered externally using the `--run-menu-command` CLI option. The polyfill likely populates a global variable (e.g., `window.__registeredMenuCommands`) which `main.js` uses.
    *   **Signature:** `GM_registerMenuCommand(name: string, callback: Function): Promise<void>`
    *   **Examples:**
        ```javascript
        // Example 1: Register a command to clear settings
        GM_registerMenuCommand("Clear My Settings", () => {
          GM_listValues().then(keys => {
            keys.forEach(key => {
              if (key.startsWith('myPlugin_')) {
                GM_deleteValue(key);
              }
            });
            alert('Settings cleared!');
          });
        });

        // Example 2: Register a command to toggle a feature
        GM_registerMenuCommand("Toggle Feature X", () => {
          GM_getValue('featureXEnabled', false).then(enabled => {
            GM_setValue('featureXEnabled', !enabled).then(() => {
               console.log(`Feature X ${!enabled ? 'enabled' : 'disabled'}. Reload may be required.`);
            });
          });
        });
        ```
        *To run the first command:* `node main.js -u <url> -m "Clear My Settings"`

## Persistent Storage

The `GM_setValue`, `GM_getValue`, `GM_deleteValue`, and `GM_listValues` functions interact with a persistent JSON file.
*   By default, this file is `gm_values.json` in the current working directory.
*   You can specify a different path using the `--storage-path` or `-s` command-line option.
*   This allows userscript data to persist across multiple runs of the manager.

## Network Interception

*   When the `--intercept-network` or `-i` flag is used, the runner will intercept all network requests made by the page and the userscripts.
*   Details about each request (URL, method, type) will be logged to the console.
*   This is useful for debugging userscript network activity or understanding page behavior.

## Menu Commands

*   Userscripts can register menu commands using `GM_registerMenuCommand(commandName, callbackFunction)`. This function is typically provided by the polyfill script.
*   The polyfill should store these registered commands in a way accessible to the main script (e.g., attaching them to the `window` object like `window.__registeredMenuCommands = window.__registeredMenuCommands || {}; window.__registeredMenuCommands[commandName] = callbackFunction;`).
*   You can execute a registered command after the page loads by passing its name via the `--run-menu-command` or `-m` CLI option. The runner will find the corresponding callback function and execute it within the page context.

## Browser Extensions

*   You can load unpacked browser extensions (e.g., for testing interactions or providing additional APIs) using the `--extensions` or `-e` option.
*   Provide a comma-separated list of paths to the directories containing the `manifest.json` file for each extension.
    ```bash
    node main.js -u <url> -e ./path/to/ext1,./another/path/to/ext2
    ```

## Polyfills

*   A polyfill script can be injected into the page *before* any userscripts run using the `--polyfill` or `-p` option.
*   The default polyfill path is `./polyfill.js`. You can create custom polyfills and place them in a `polyfills/` directory or elsewhere.
*   Polyfills are useful for:
    *   Providing implementations for GM\_ functions not natively supported by the runner's bridge.
    *   Setting up helper functions or objects needed by userscripts.
    *   Modifying the page environment in preparation for userscripts.
## Made With

This project was developed with assistance from:

*   [GitHub Copilot](https://github.com/features/copilot)
*   Roo Code (VS Code Extension)
*   [Google Gemini](https://gemini.google.com/)
## License

MIT License

Copyright (c) 2025 Robert Headley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
love &lt;3