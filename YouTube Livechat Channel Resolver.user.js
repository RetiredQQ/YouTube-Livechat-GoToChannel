// ==UserScript==
// @name            YouTube Livechat GoToChannel
// @namespace       https://github.com/RetiredQQ/YouTube-Livechat-GoToChannel
// @version         1.1
// @description     A script to restore the "Go To Channel" option on any live chat comment on YouTube.
// @description:de  Ein Skript, um die "Zum Kanal" Funktion bei allen Livechat-Kommentaren auf YouTube wiederherzustellen.
// @author          Zerody
// @icon            https://www.google.com/s2/favicons?domain=youtube.com
// @updateURL       https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/raw/master/YouTube%20Livechat%20Channel%20Resolver.user.js
// @downloadURL     https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/raw/master/YouTube%20Livechat%20Channel%20Resolver.user.js
// @supportURL      https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/issues
// @license         MIT
// @match           https://www.youtube.com/*
// @grant           none
// @compatible      chrome Chrome + Tampermonkey or Violentmonkey
// @compatible      firefox Firefox + Greasemonkey or Tampermonkey or Violentmonkey
// @compatible      opera Opera + Tampermonkey or Violentmonkey
// @compatible      edge Edge + Tampermonkey or Violentmonkey
// @compatible      safari Safari + Tampermonkey or Violentmonkey
// ==/UserScript==

(function() {
    'use strict';

    const main = () => {
        let mappedChannelIds = [];

        // Backup original functions
        const originalRequestOpen = XMLHttpRequest.prototype.open;
        const originalFetch = window.fetch;
        const trustedTypePolicy = window.trustedTypes
            ? window.trustedTypes.createPolicy("ytgtc_policy", { createHTML: (input) => input, createScript: (input) => input })
            : { createHTML: (input) => input, createScript: (input) => input };

        // Helper to intercept and modify responses
        const responseProxy = (callback) => {
            // Intercept XMLHttpRequest
            XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                this._method = method;
                this._url = url;
                this._async = async;
                this._user = user;
                this._password = password;
                return originalRequestOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(body) {
                this.addEventListener("readystatechange", function() {
                    if (this.readyState === 4) { // DONE
                        try {
                            const responseType = this.responseType;
                            const responseURL = this.responseURL;
                            let modifiedResponse = null;

                            if (responseType === '' || responseType === 'text') {
                                // Safe to access responseText
                                modifiedResponse = callback(responseURL, this.responseText);
                                if (modifiedResponse && modifiedResponse !== this.responseText) {
                                    // Redefine response and responseText if modified
                                    Object.defineProperty(this, "response", { writable: true });
                                    Object.defineProperty(this, "responseText", { writable: true });
                                    this.response = modifiedResponse;
                                    this.responseText = modifiedResponse;
                                }
                            } else if (responseType === 'json') {
                                // Cannot access responseText, but can modify 'response' directly
                                const originalResponse = this.response;
                                if (originalResponse && typeof originalResponse === 'object') {
                                    const modifiedResponseObject = callback(responseURL, JSON.stringify(originalResponse));
                                    if (modifiedResponseObject && modifiedResponseObject !== JSON.stringify(originalResponse)) {
                                        // Parse the modified response back into object
                                        const newResponse = JSON.parse(modifiedResponseObject);
                                        // Redefine response to the new object
                                        Object.defineProperty(this, "response", { writable: true });
                                        this.response = newResponse;
                                    }
                                }
                            }
                            // For other responseTypes, do nothing
                        } catch (ex) {
                            console.error("YouTube Livechat Channel Resolver - Exception in XMLHttpRequest handler:", ex);
                        }
                    }
                });
                return originalFetch.apply(this, arguments);
            };

            // Intercept Fetch API
            window.fetch = async (...args) => {
                const response = await originalFetch(...args);
                const clonedResponse = response.clone();

                let modifiedResponseText = null;

                try {
                    const contentType = clonedResponse.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const json = await clonedResponse.json();
                        const originalJsonString = JSON.stringify(json);
                        modifiedResponseText = callback(response.url, originalJsonString);
                    }
                } catch (e) {
                    // If response is not JSON, do nothing
                    return response;
                }

                if (modifiedResponseText && modifiedResponseText !== JSON.stringify(await response.clone().json())) {
                    return new Response(modifiedResponseText, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                } else {
                    return response;
                }
            };
        };

        // Extract Channel IDs from chat actions
        const extractCommentActionChannelId = (action) => {
            if (action.replayChatItemAction) {
                action.replayChatItemAction.actions.forEach(extractCommentActionChannelId);
                return;
            }

            if (!action.addChatItemAction) return;

            const messageItem = action.addChatItemAction.item;
            const mappedItem = messageItem.liveChatPaidMessageRenderer ||
                               messageItem.liveChatTextMessageRenderer ||
                               messageItem.liveChatPaidStickerRenderer ||
                               messageItem.liveChatMembershipItemRenderer ||
                               (messageItem.liveChatAutoModMessageRenderer?.autoModeratedItem.liveChatTextMessageRenderer);

            if (!mappedItem || !mappedItem.authorExternalChannelId) return;

            // Maintain a maximum of 5000 entries
            if (mappedChannelIds.length > 5000) mappedChannelIds.shift();

            mappedChannelIds.push({
                channelId: mappedItem.authorExternalChannelId,
                commentId: mappedItem.id,
                contextMenuEndpointParams: mappedItem.contextMenuEndpoint?.liveChatItemContextMenuEndpoint?.params || ""
            });
        };

        // Extract Channel IDs from API response
        const extractAuthorExternalChannelIds = (chatData) => {
            const availableCommentActions = chatData.continuationContents
                ? chatData.continuationContents.liveChatContinuation.actions
                : chatData.contents?.liveChatRenderer?.actions;

            if (!availableCommentActions || !Array.isArray(availableCommentActions)) return;

            availableCommentActions.forEach(extractCommentActionChannelId);
            console.info(`${mappedChannelIds.length} Channel-IDs mapped!`);
        };

        // Generate a menu item for the context menu
        const generateMenuLinkItem = (url, text, icon) => ({
            "menuNavigationItemRenderer": {
                "text": { "runs": [{ "text": text }] },
                "icon": { "iconType": icon },
                "navigationEndpoint": {
                    "commandMetadata": {
                        "webCommandMetadata": {
                            "url": url,
                            "webPageType": "WEB_PAGE_TYPE_UNKNOWN",
                            "rootVe": 0
                        }
                    }
                }
            }
        });

        // Append additional items to the context menu
        const appendAdditionalChannelContextItems = (reqUrl, response) => {
            try {
                const urlParams = new URLSearchParams(new URL(reqUrl).search);
                const params = urlParams.get("params");
                const mappedChannel = mappedChannelIds.find(x => x.contextMenuEndpointParams === params);

                if (!mappedChannel) {
                    console.error(`Endpoint Params ${params} not mapped!`);
                    return response;
                }

                const responseData = JSON.parse(response);
                const mainMenuRendererNode = responseData.liveChatItemContextMenuSupportedRenderers?.menuRenderer;

                if (!mainMenuRendererNode || !mainMenuRendererNode.items) {
                    console.error("Invalid structure for liveChatItemContextMenuSupportedRenderers.menuRenderer");
                    return response;
                }

                // Remove the first item if it's the 'Account Circle' (typically for moderators)
                if (mainMenuRendererNode.items[0]?.menuNavigationItemRenderer?.icon?.iconType === "ACCOUNT_CIRCLE") {
                    mainMenuRendererNode.items.shift();
                }

                // Prepend new menu items
                mainMenuRendererNode.items.unshift(
                    generateMenuLinkItem(`https://socialblade.com/youtube/channel/${mappedChannel.channelId}`, "Socialblade Statistic", "MONETIZATION_ON"),
                    generateMenuLinkItem(`https://playboard.co/en/channel/${mappedChannel.channelId}`, "PlayBoard Statistic", "INSIGHTS"),
                    generateMenuLinkItem(`/channel/${mappedChannel.channelId}`, "Visit Channel", "ACCOUNT_CIRCLE")
                );

                // Return the modified response
                return JSON.stringify(responseData);
            } catch (ex) {
                console.error("YouTube Livechat Channel Resolver - Exception in appendAdditionalChannelContextItems:", ex);
                return response;
            }
        };

        // Proxy to process and edit API responses
        responseProxy((reqUrl, responseText) => {
            try {
                if (reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat")) {
                    const jsonResponse = JSON.parse(responseText);
                    extractAuthorExternalChannelIds(jsonResponse);
                }

                if (reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay")) {
                    const jsonResponse = JSON.parse(responseText);
                    extractAuthorExternalChannelIds(jsonResponse);
                }

                if (reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_item_context_menu")) {
                    return appendAdditionalChannelContextItems(reqUrl, responseText);
                }

            } catch (ex) {
                console.error("YouTube Livechat Channel Resolver - Exception in responseProxy:", ex);
            }

            return responseText;
        });

        // Inject the script into the page context
        const injectScript = (frameWindow) => {
            console.info("YouTube Livechat GoToChannel script injected.");

            frameWindow.eval(trustedTypePolicy.createScript(`(${main.toString()})();`));
        };

        // Retrieve the chat frame window
        const retrieveChatFrameWindow = () => {
            if (window.location.pathname === "/live_chat" || window.location.pathname === "/live_chat_replay") {
                return window;
            }

            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const framePath = window.frames[i].location.pathname;
                    if (framePath === "/live_chat" || framePath === "/live_chat_replay") {
                        return window.frames[i];
                    }
                } catch (ex) {
                    // Ignore cross-origin frames
                }
            }
            return null;
        };

        // Execute the injection process
        const tryBrowserIndependentExecution = () => {
            const destinationFrameWindow = retrieveChatFrameWindow();

            if (!destinationFrameWindow || !destinationFrameWindow.document || destinationFrameWindow.document.readyState !== "complete") {
                setTimeout(tryBrowserIndependentExecution, 1000);
                return;
            }

            if (destinationFrameWindow.channelResolverInitialized) return;

            injectScript(destinationFrameWindow);
            destinationFrameWindow.channelResolverInitialized = true;
        };

        // Start the injection process
        tryBrowserIndependentExecution();
    };

    // Initialize the main function
    main();
})();
