// Background Service Worker for Altera Recorder
// Maintains global recording state and ensures content script connectivity

const STORAGE_KEYS = {
  recording: 'altera_recording',
  events: 'altera_recorder_events',
  sessionId: 'altera_session_id',
  recordings: 'altera_recordings'
};

// Global recording state
let isRecording = false;
let recordingTabId = null;

// Initialize on startup
chrome.runtime.onStartup.addListener(initializeState);
chrome.runtime.onInstalled.addListener(initializeState);

async function initializeState() {
  console.log('Background: Initializing state');
  const { [STORAGE_KEYS.recording]: recording = false } = await chrome.storage.local.get([STORAGE_KEYS.recording]);
  isRecording = Boolean(recording);
  console.log('Background: Recording state restored:', isRecording);
}

// Listen for tab updates to ensure content script injection
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    // If we're recording and this is the recording tab, ensure content script is ready
    if (isRecording && (recordingTabId === null || recordingTabId === tabId)) {
      console.log('Background: Tab updated, ensuring content script for recording tab:', tabId);
      try {
        // Test if content script is responsive
        const response = await chrome.tabs.sendMessage(tabId, { 
          type: 'RECORDER_CONTROL', 
          action: 'ping' 
        });
        if (!response || !response.ok) {
          console.log('Background: Content script not responsive, re-injecting');
          await reinjectContentScript(tabId);
        }
      } catch (error) {
        console.log('Background: Content script not found, injecting');
        await reinjectContentScript(tabId);
      }
    }
  }
});

// Handle navigation within the same tab (SPA routing)
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (isRecording && (recordingTabId === null || recordingTabId === details.tabId)) {
    console.log('Background: SPA navigation detected, ensuring content script');
    try {
      await chrome.tabs.sendMessage(details.tabId, {
        type: 'RECORDER_CONTROL',
        action: 'syncState'
      });
    } catch (error) {
      console.log('Background: Failed to sync state after navigation, re-injecting');
      await reinjectContentScript(details.tabId);
    }
  }
});

async function reinjectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    console.log('Background: Content script re-injected for tab:', tabId);
  } catch (error) {
    console.error('Background: Failed to re-inject content script:', error);
  }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BACKGROUND_CONTROL') {
    handleBackgroundMessage(message, sender, sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleBackgroundMessage(message, sender, sendResponse) {
  const { action } = message;
  
  switch (action) {
    case 'startRecording':
      isRecording = true;
      recordingTabId = sender.tab?.id || null;
      await chrome.storage.local.set({ [STORAGE_KEYS.recording]: true });
      console.log('Background: Recording started on tab:', recordingTabId);
      sendResponse({ ok: true });
      break;
      
    case 'stopRecording':
      isRecording = false;
      recordingTabId = null;
      await chrome.storage.local.set({ [STORAGE_KEYS.recording]: false });
      console.log('Background: Recording stopped');
      sendResponse({ ok: true });
      break;
      
    case 'getRecordingState':
      sendResponse({ 
        ok: true, 
        recording: isRecording, 
        tabId: recordingTabId 
      });
      break;
      
    case 'ensureContentScript':
      const tabId = message.tabId || sender.tab?.id;
      if (tabId) {
        await reinjectContentScript(tabId);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'No tab ID provided' });
      }
      break;
      
    default:
      sendResponse({ ok: false, error: 'Unknown action' });
  }
}

// Ensure we have webNavigation permission
chrome.permissions.contains({
  permissions: ['webNavigation']
}, (result) => {
  if (!result) {
    console.warn('Background: webNavigation permission not available');
  }
});
