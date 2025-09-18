async function sendToActiveTab(message) {
  function send(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, async (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }

  // Try the active tab in the last focused window
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && active.id != null) {
    let res = await send(active.id);
    if (res && !res.ok && /Receiving end does not exist|Could not establish/i.test(res.error || '')) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: active.id }, files: ['content.js'] });
        res = await send(active.id);
      } catch (_) {}
    }
    if (res && res.ok) return res;
  }

  // Fallback: find any http(s) tab and try there
  const httpTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of httpTabs) {
    try {
      const res = await send(t.id);
      if (res && res.ok) return res;
    } catch (_) {}
  }
  return { ok: false, error: 'No eligible tab for messaging' };
}

async function refresh() {
  const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'getEvents' });
  const textarea = document.getElementById('events');
  const statusWrap = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  
  if (res && res.ok) {
    textarea.value = JSON.stringify(res.events, null, 2);
    statusText.textContent = res.recording ? 'Recording…' : 'Idle';
    statusWrap.classList.toggle('recording', !!res.recording);
    
    // Update Start/Stop button visibility
    if (res.recording) {
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'block';
    } else {
      if (startBtn) startBtn.style.display = 'block';
      if (stopBtn) stopBtn.style.display = 'none';
    }
    
    renderTimeline(res.events || []);
  } else {
    textarea.value = '';
    statusText.textContent = 'Idle';
    statusWrap.classList.remove('recording');
    
    // Show Start button when not recording
    if (startBtn) startBtn.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'none';
    
    renderTimeline([]);
  }
}

// Wait for DOM to load before adding event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Recorder view buttons
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const clearBtn = document.getElementById('clear');
  const refreshBtn = document.getElementById('refresh');
  
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'start' });
      refresh();
    });
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'stop' });
      refresh();
    });
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'clear' });
      refresh();
    });
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refresh);
  }
});
async function showDashboard(stopRecording = false) {
  // Only stop recording if explicitly requested
  if (stopRecording) {
    await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'stop' });
  }
  
  document.getElementById('dashboardView').style.display = 'block';
  document.getElementById('recorderView').style.display = 'none';
  loadDashboardInPopup();
  try {
    document.getElementById('btnDashboard').classList.add('primary');
    document.getElementById('btnRecorder').classList.remove('primary');
  } catch (_) {}
  
  // Update status
  refresh();
}
function showRecorder(clearState = false) {
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('recorderView').style.display = 'block';
  
  if (clearState) {
    // Clear for new recording
    const nameInput = document.getElementById('recName');
    const dropdown = document.getElementById('recList');
    const eventsTextarea = document.getElementById('events');
    const timeline = document.getElementById('timeline');
    
    if (nameInput) {
      nameInput.value = '';
      console.log('Cleared name input');
    }
    if (dropdown) {
      dropdown.innerHTML = '<option value="">-- New Recording --</option>';
      dropdown.value = '';
      dropdown.selectedIndex = 0;
      dropdown.disabled = true; // Disable dropdown for new recordings
      console.log('Cleared and disabled dropdown for new recording');
    }
    if (eventsTextarea) {
      eventsTextarea.value = '';
      eventsTextarea.placeholder = 'Recorded events will appear here...';
      console.log('Cleared events textarea');
    }
    if (timeline) {
      timeline.innerHTML = '';
      console.log('Cleared timeline');
    }
    
    // Also clear the current events from storage for this session
    chrome.storage.local.set({ altera_recorder_events: [] });
    // Clear temp name for truly fresh start
    chrome.storage.local.remove(['altera_temp_name']);
    console.log('Cleared storage events and temp name for new recording');
  }
  
  // Refresh recorder state when switching in (but not if we just cleared)
  if (!clearState) {
    // Re-enable dropdown when not clearing state
    const dropdown = document.getElementById('recList');
    if (dropdown) {
      dropdown.disabled = false;
    }
    try { refresh(); } catch (_) {}
  }
  try {
    document.getElementById('btnRecorder').classList.add('primary');
    document.getElementById('btnDashboard').classList.remove('primary');
  } catch (_) {}
}
document.addEventListener('DOMContentLoaded', () => {
  // Save recording name as user types
  const nameInput = document.getElementById('recName');
  if (nameInput) {
    // Restore saved name on load
    chrome.storage.local.get(['altera_temp_name'], (result) => {
      if (result.altera_temp_name) {
        nameInput.value = result.altera_temp_name;
      }
    });
    
    // Save name as user types
    nameInput.addEventListener('input', () => {
      chrome.storage.local.set({ altera_temp_name: nameInput.value });
    });
  }
  
  // Tab navigation buttons
  const dashboardBtn = document.getElementById('btnDashboard');
  const recorderBtn = document.getElementById('btnRecorder');
  
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', (e) => {
      console.log('Dashboard clicked - stopping recording and refreshing');
      showDashboard(true); // Stop recording when user manually clicks Dashboard
      // Force refresh dashboard data
      setTimeout(() => {
        loadDashboardInPopup();
      }, 50);
    });
  }
  
  if (recorderBtn) {
    recorderBtn.addEventListener('click', (e) => {
      console.log('Recorder clicked');
      showRecorder();
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'getEvents' });
      const data = JSON.stringify(res && res.ok ? res.events : [], null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'altera-trace.json', saveAs: true }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      });
    });
  }
});

async function refreshRecordingList() {
  const sel = document.getElementById('recList');
  if (!sel) return;
  
  // Don't refresh if dropdown is disabled (New Recording mode)
  if (sel.disabled) {
    console.log('Skipping recording list refresh - in New Recording mode');
    return;
  }
  
  const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'listRecordings' });
  sel.innerHTML = '';
  
  // Add empty option first to prevent auto-selection
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '-- Select Recording --';
  sel.appendChild(emptyOpt);
  
  if (res && res.ok) {
    const items = res.items || [];
    for (const meta of items) {
      const opt = document.createElement('option');
      opt.value = meta.id;
      opt.textContent = meta.name;
      sel.appendChild(opt);
    }
  }
  
  // Ensure no recording is selected by default
  sel.selectedIndex = 0;
}

async function captureThumb() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 }, (dataUrl) => {
        resolve(dataUrl || null);
      });
    } catch (e) { resolve(null); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      console.log('Save clicked - stopping recording and saving');
      
      // First, stop the recording if it's active
      const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'getEvents' });
      if (res && res.ok && res.recording) {
        console.log('Stopping active recording before save');
        await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'stop' });
        
        // Also notify background script
        try {
          await chrome.runtime.sendMessage({
            type: 'BACKGROUND_CONTROL',
            action: 'stopRecording'
          });
        } catch (error) {
          console.warn('Failed to notify background script of stop:', error);
        }
      }
      
      const nameInput = document.getElementById('recName');
      const name = nameInput ? nameInput.value.trim() : '';
      const thumb = await captureThumb();
      
      // Always use fallback method since messaging is unreliable
      try {
        const keys = await chrome.storage.local.get(['altera_recorder_events', 'altera_recordings']);
        const events = keys['altera_recorder_events'] || [];
        console.log('Events to save:', events);
        const recordings = keys['altera_recordings'] || {};
        
        // Always create new recording when saving from active recording session
        // Only update existing if explicitly loaded from dropdown AND not currently recording
        const dropdown = document.getElementById('recList');
        const existingId = dropdown ? dropdown.value : null;
        const isCurrentlyRecording = res && res.ok && res.recording;
        
        let recId, recName;
        if (existingId && recordings[existingId] && !isCurrentlyRecording) {
          // Update existing recording (only if not currently recording)
          recId = existingId;
          recName = name || recordings[existingId].name || `Recording ${new Date().toLocaleString()}`;
          console.log('Updating existing recording:', recId);
        } else {
          // Create new recording (default behavior, especially when recording)
          recId = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          recName = name || `Recording ${new Date().toLocaleString()}`;
          console.log('Creating new recording:', recId);
        }
        
        recordings[recId] = { 
          id: recId, 
          name: recName, 
          events, 
          meta: { id: recId, name: recName, savedAt: Date.now(), thumb: thumb || null } 
        };
        
        console.log('About to save recording:', recId, recName);
        console.log('Recording object:', recordings[recId]);
        console.log('All recordings before save:', Object.keys(recordings));
        
        await chrome.storage.local.set({ altera_recordings: recordings });
        console.log('Successfully saved recording:', recId, recName);
        
        // Clear the temporary name since we saved successfully
        await chrome.storage.local.remove(['altera_temp_name']);
        
        // Clear the name input
        const nameInput = document.getElementById('recName');
        if (nameInput) {
          nameInput.value = '';
        }
        
        // Verify it was saved
        const verification = await chrome.storage.local.get(['altera_recordings']);
        console.log('Verification - recordings in storage:', Object.keys(verification.altera_recordings || {}));
        
        // Toast feedback
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = `Saved ${recName}`;
          toast.style.display = 'block';
          setTimeout(() => { toast.style.display = 'none'; }, 1200);
        }
        
        // Update UI to show recording stopped
        refresh();
        
        // Switch to dashboard and force refresh
        showDashboard();
        
        // Force reload dashboard data after a brief delay to ensure storage is written
        setTimeout(() => {
          loadDashboardInPopup();
        }, 100);
        
      } catch (e) {
        console.error('Save failed:', e);
        alert('Save failed: ' + String(e));
      }
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const loadBtn = document.getElementById('load');
  const delBtn = document.getElementById('del');
  const replayBtn = document.getElementById('replayInline');
  
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const sel = document.getElementById('recList');
      const id = sel ? sel.value : null;
      if (!id) return;
      const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'loadRecording', id });
      if (res && res.ok) {
        const eventsTextarea = document.getElementById('events');
        if (eventsTextarea) {
          eventsTextarea.value = JSON.stringify(res.events, null, 2);
        }
        renderTimeline(res.events || []);
      }
    });
  }
  
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const sel = document.getElementById('recList');
      const id = sel ? sel.value : null;
      if (!id) return;
      await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'deleteRecording', id });
      await refreshRecordingList();
    });
  }
  
  if (replayBtn) {
    replayBtn.addEventListener('click', async () => {
      let events;
      try {
        const eventsTextarea = document.getElementById('events');
        events = JSON.parse(eventsTextarea ? eventsTextarea.value || '[]' : '[]');
      } catch (_) {
        events = [];
      }
      const currentUrl = new URL((await chrome.tabs.query({ active: true, currentWindow: true }))[0].url || 'about:blank');
      const target = new URL(events?.[0]?.page?.url || currentUrl.href);
      if (currentUrl.host !== target.host) {
        alert(`Replay blocked: current tab is ${currentUrl.host}, but recording target is ${target.host}. Navigate to ${target.host} and try again.`);
        return;
      }
      // Quick diagnosis before replay
      const diag = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'diagnose' });
      if (diag && diag.ok && !diag.info.hasPrompt) {
        console.warn('Diagnosis: prompt not found yet. Waiting 1s before replay.');
        await new Promise(r => setTimeout(r, 1000));
      }
      const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'replayInline', events });
      if (!res || !res.ok) {
        alert('Replay failed: ' + (res && res.error ? res.error : 'unknown error'));
      }
    });
  }
});

function renderTimeline(events) {
  const container = document.getElementById('timeline');
  container.innerHTML = '';
  let i = 0;
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'step';
    const dot = document.createElement('div');
    dot.className = 'dot';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = `${++i}. ${ev.type}` + (ev.selector ? ` ${ev.selector}` : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new URL(ev.page?.url || 'about:blank').host + ' • ' + (ev.page?.title || '');
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(dot);
    row.appendChild(info);
    container.appendChild(row);
  }
}

// Remove these - now handled in DOMContentLoaded

// Dashboard-in-popup
async function loadDashboardInPopup() {
  console.log('Loading dashboard data...');
  const { altera_recordings: recordings = {} } = await chrome.storage.local.get(['altera_recordings']);
  console.log('Raw storage data:', recordings);
  console.log('Storage keys:', Object.keys(recordings));
  const list = document.getElementById('dbList');
  const count = document.getElementById('dbCount');
  if (!list || !count) {
    console.error('Dashboard elements not found:', { list, count });
    return;
  }
  list.innerHTML = '';
  const values = Object.values(recordings);
  count.textContent = `${values.length} recording${values.length === 1 ? '' : 's'}`;
  console.log('Found recordings:', values.length, values);
  for (const r of values) {
    const card = document.createElement('div');
    card.className = 'thumb';
    
    const img = document.createElement('img');
    img.src = r.meta?.thumb || '';
    
    const content = document.createElement('div');
    content.className = 'thumb-content';
    
    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = r.name || r.id;
    
    const meta = document.createElement('div');
    meta.className = 'meta';
    const when = r.meta?.savedAt ? new Date(r.meta.savedAt).toLocaleString() : '';
    meta.textContent = `${r.events?.length || 0} steps • ${when}`;
    
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    
    const btnLoad = document.createElement('button');
    btnLoad.textContent = 'Open';
    btnLoad.onclick = async () => {
      console.log('Open clicked for recording:', r.id, r);
      try {
        // Switch to recorder view first
        showRecorder();
        
        // Load from storage directly since we have the data
        const events = r.events || [];
        console.log('Events to load:', events);
        
        // Set up UI for editing existing recording
        const nameInput = document.getElementById('recName');
        const dropdown = document.getElementById('recList');
        const eventsTextarea = document.getElementById('events');
        
        // Set the recording name
        if (nameInput) {
          nameInput.value = r.name || r.id;
          console.log('Set name input to:', r.name || r.id);
        }
        
        // Enable dropdown and select this recording
        if (dropdown) {
          dropdown.disabled = false;
          dropdown.value = r.id;
          console.log('Selected recording in dropdown:', r.id);
        }
        
        // Set events
        if (eventsTextarea) {
          eventsTextarea.value = JSON.stringify(events, null, 2);
          console.log('Set textarea value');
        } else {
          console.error('Events textarea not found');
        }
        
        renderTimeline(events);
        console.log('Loaded recording with', events.length, 'events');
      } catch (err) {
        console.error('Failed to open recording:', err);
      }
    };
    
    const btnExport = document.createElement('button');
    btnExport.textContent = 'Export';
    btnExport.onclick = () => {
      const data = JSON.stringify(r.events || [], null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: `${(r.name || r.id)}.json`, saveAs: true }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    };
    
    actions.appendChild(btnLoad);
    actions.appendChild(btnExport);
    content.appendChild(title);
    content.appendChild(meta);
    content.appendChild(actions);
    card.appendChild(img);
    card.appendChild(content);
    list.appendChild(card);
  }
}

// Initialize popup after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  // New recording button (created dynamically in dashboard)
  setTimeout(() => {
    const newBtn = document.getElementById('newRecording');
    if (newBtn) {
      console.log('Found newRecording button, adding listener');
      newBtn.addEventListener('click', async (e) => {
        console.log('New recording clicked - switching to recorder (not starting)');
        showRecorder(true); // Clear state for new recording
        // Don't auto-start recording - user should click Start button
      });
    }
  }, 200);

  // Check if currently recording to decide which view to show
  const checkRecording = async () => {
    // First check with background script for global state
    let isRecording = false;
    try {
      const bgResponse = await chrome.runtime.sendMessage({
        type: 'BACKGROUND_CONTROL',
        action: 'getRecordingState'
      });
      if (bgResponse && bgResponse.ok) {
        isRecording = bgResponse.recording;
        console.log('Background script reports recording state:', isRecording);
      }
    } catch (error) {
      console.warn('Failed to get state from background script:', error);
    }
    
    // Fallback to content script check
    if (!isRecording) {
      const res = await sendToActiveTab({ type: 'RECORDER_CONTROL', action: 'getEvents' });
      if (res && res.ok && res.recording) {
        isRecording = true;
        console.log('Content script reports recording in progress');
      }
    }
    
    if (isRecording) {
      // If recording, show recorder view
      console.log('Recording in progress, showing recorder view');
      showRecorder(false); // Don't clear state
    } else {
      // If not recording, show dashboard
      showDashboard();
    }
    refresh();
    refreshRecordingList();
  };
  
  // Initialize views
  checkRecording();
});


