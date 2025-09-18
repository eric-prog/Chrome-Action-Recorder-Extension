async function loadRecordings() {
  const { altera_recordings: recordings = {} } = await chrome.storage.local.get(['altera_recordings']);
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  list.innerHTML = '';
  const values = Object.values(recordings);
  count.textContent = `${values.length} recording${values.length === 1 ? '' : 's'}`;
  if (values.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  for (const r of values) {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = r.name || r.id;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const when = r.meta?.savedAt ? new Date(r.meta.savedAt).toLocaleString() : '';
    meta.textContent = `${r.events?.length || 0} steps • ${when}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = r.name || '';
    input.placeholder = 'Rename…';

    const row = document.createElement('div');
    row.className = 'row';
    const btnRename = document.createElement('button');
    btnRename.textContent = 'Rename';
    btnRename.onclick = async () => {
      const name = input.value.trim() || r.id;
      const { altera_recordings: recs = {} } = await chrome.storage.local.get(['altera_recordings']);
      if (recs[r.id]) {
        recs[r.id].name = name;
        recs[r.id].meta = recs[r.id].meta || {};
        recs[r.id].meta.name = name;
        await chrome.storage.local.set({ altera_recordings: recs });
        loadRecordings();
      }
    };
    const btnExport = document.createElement('button');
    btnExport.textContent = 'Export JSON';
    btnExport.onclick = () => {
      const data = JSON.stringify(r.events || [], null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: `${(r.name || r.id)}.json`, saveAs: true }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    };
    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.onclick = async () => {
      const { altera_recordings: recs = {} } = await chrome.storage.local.get(['altera_recordings']);
      delete recs[r.id];
      await chrome.storage.local.set({ altera_recordings: recs });
      loadRecordings();
    };

    row.appendChild(btnRename);
    row.appendChild(btnExport);
    row.appendChild(btnDelete);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(input);
    card.appendChild(row);
    list.appendChild(card);
  }
}

loadRecordings();


