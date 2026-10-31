const $ = (id) => document.getElementById(id);

function pretty(shortcut, platform) {
  return shortcut.replace('CommandOrControl', platform === 'darwin' ? 'Cmd' : 'Ctrl').split('+').map((k) => `<kbd>${k}</kbd>`).join('+');
}

function renderMicCurrent(label) {
  $('micCurrent').textContent = label ? `Routing to: ${label}` : 'Not set up yet — choose a device below.';
}

panel.info().then((info) => {
  $('qr').src = info.qr;
  $('url').textContent = info.url;
  $('code').textContent = info.code;
  $('autolaunch').checked = info.openAtLogin;
  renderMicCurrent(info.micDeviceLabel);
  if (info.urls.length > 1) {
    $('other').textContent = 'Not working? Also try: ' + info.urls.slice(1).map((u) => `${u.address}:${info.port}`).join(', ');
  }
  $('tips').innerHTML = `
    Show this window again: ${pretty(info.shortcuts.panel, info.platform)} or the tray icon.<br>
    Emergency stop all effects: ${pretty(info.shortcuts.panic, info.platform)}<br>
    Scares not showing over the game? Set the game to <b>Borderless</b> / <b>Windowed fullscreen</b>.`;
});

panel.onStatus((s) => {
  const ok = s.clients > 0;
  $('status').className = 'status' + (ok ? ' ok' : '');
  let text = ok ? `iPad connected${s.clients > 1 ? ` (${s.clients})` : ''} – you're ready!` : 'Waiting for your iPad on Wi-Fi…';
  if (s.haunt) text += ' · 👻 haunt mode on';
  $('statusText').textContent = text;
});

$('autolaunch').addEventListener('change', (e) => panel.setAutolaunch(e.target.checked));

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
$('micChoose').onclick = async () => {
  const btn = $('micChoose');
  btn.disabled = true; btn.textContent = 'Scanning…';
  const { devices, selected } = await panel.micDevices();
  const sel = $('micDevice');
  sel.innerHTML = '<option value="">— none (mic trolls off) —</option>'
    + '<option value="default">System default output</option>'
    + devices.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label)}</option>`).join('');
  sel.value = selected || '';
  sel.hidden = false;
  btn.disabled = false;
  btn.textContent = devices.length ? 'Rescan devices' : 'No devices found — try again';
};
$('micDevice').onchange = () => {
  const sel = $('micDevice');
  const label = sel.value ? sel.options[sel.selectedIndex].text : '';
  panel.setMicDevice({ deviceId: sel.value, label });
  renderMicCurrent(label);
};

$('hide').onclick = () => panel.hide();
$('test').onclick = () => panel.test('airhorn');
$('media').onclick = () => panel.openMedia();
$('quit').onclick = () => panel.quit();
