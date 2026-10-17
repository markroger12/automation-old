const $ = (id) => document.getElementById(id);

const STATE_LABELS = {
  working: 'Working',
  idle: 'Ready',
  attention: 'Needs you',
  login: 'Log in',
  error: 'Error',
  loading: 'Loading',
  paused: 'Paused',
  stopped: 'Paused',
  starting: 'Starting',
};

function send(message) {
  return chrome.runtime.sendMessage(message).catch((err) => ({ ok: false, error: err.message }));
}

function showMessage(el, ok, text) {
  el.textContent = text;
  el.className = `msg show ${ok ? 'ok' : 'err'}`;
}

const screenArea = () => ({ left: screen.availLeft || 0, top: screen.availTop || 0, width: screen.availWidth, height: screen.availHeight });
let paused = false;

async function refresh(first = false) {
  const state = await send({ type: 'popup:state' });
  if (!state || state.ok === false) return;
  if (first) {
    $('appUrl').value = state.appUrl;
    $('layout').value = state.layout === 'windows' ? 'windows' : 'tabs';
  }
  paused = Boolean(state.paused);
  $('toggle').textContent = paused ? 'Switch automatic start on' : 'Pause automatic start';
  $('autoText').textContent = paused
    ? 'Paused: ChatGPT tabs do not open by themselves and take no new prompts.'
    : `On: ChatGPT tabs open by themselves for queued articles (up to ${state.concurrency ?? 'Task Concurrency'} at once) and close when an article's ChatGPT part is done.`;
  if (state.lastError) {
    showMessage($('runMsg'), false, state.lastError);
    $('runMsg').dataset.auto = '1';
  } else if ($('runMsg').dataset.auto) {
    $('runMsg').className = 'msg';
    delete $('runMsg').dataset.auto;
  }
  $('keyHint').textContent = state.hasKey ? 'A key is saved. Paste a new one only if you created a new key in the app.' : '';
  $('summary').textContent =
    (paused ? 'Paused' : `Automatic — ${state.workers.length} ChatGPT tab(s) open`) +
    (state.automationChrome ? ' · Automation Chrome ✓' : ' · normal Chrome');

  const list = $('workers');
  list.replaceChildren();
  if (!state.workers.length) {
    const li = document.createElement('li');
    li.textContent = paused ? 'No ChatGPT tabs open.' : 'No ChatGPT tabs open — they open by themselves when articles are queued.';
    li.style.cursor = 'default';
    list.append(li);
    return;
  }
  for (const w of state.workers) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = `state ${w.state}`;
    badge.textContent = STATE_LABELS[w.state] || w.state;
    const title = document.createElement('strong');
    title.textContent = `ChatGPT #${w.index}`;
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = w.detail || '';
    li.append(badge, title, detail);
    li.title = 'Show this tab';
    li.addEventListener('click', () => send({ type: 'popup:focus', tabId: w.tabId }));
    list.append(li);
  }
}

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  const res = await send({ type: 'popup:save', appUrl: $('appUrl').value, key: $('key').value, layout: $('layout').value });
  $('save').disabled = false;
  if (res.ok) {
    $('key').value = '';
    showMessage($('saveMsg'), true, 'Connected to Blog Automation Studio.');
  } else {
    showMessage($('saveMsg'), false, res.error || 'Could not connect');
  }
  refresh();
});

$('toggle').addEventListener('click', async () => {
  await send({ type: 'popup:pause', paused: !paused });
  refresh();
});

$('openNow').addEventListener('click', async () => {
  $('openNow').disabled = true;
  const res = await send({ type: 'popup:open-now', area: screenArea() });
  $('openNow').disabled = false;
  if (res.ok) showMessage($('runMsg'), true, `${res.tabs} ChatGPT tab(s) open.`);
  else showMessage($('runMsg'), false, res.error || 'Could not open ChatGPT tabs');
  refresh();
});

$('layout').addEventListener('change', () => send({ type: 'popup:layout', layout: $('layout').value }));

$('reload').addEventListener('click', () => chrome.runtime.reload());

send({ type: 'popup:area', area: screenArea() });
refresh(true);
setInterval(refresh, 2000);
