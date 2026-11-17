/* Singing Scripture Listen player.
   One persistent <audio> element (in the page). Tracks advance by swapping src
   on 'ended' — no new elements, no setTimeout to go to the next song.
   Sleep timer expires by comparing Date.now() inside 'timeupdate' (background
   setTimeout is throttled when the phone screen is locked).
   Play counts: one anonymous GoatCounter event after ~30s of actual playback. */
(function () {
  "use strict";

  var audio = document.getElementById("player-audio");
  if (!audio) return;
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");
  audio.preload = "metadata";

  var data = { songs: [], playlists: [] };
  var byId = {};
  var queue = [];
  var index = 0;
  var activeList = "all";
  var sleepUntil = 0;
  var fading = false;
  var baseVolume = 0.9;

  var playedSec = 0;
  var counted = false;
  var lastTime = 0;
  var countedSongId = null;

  var $ = function (sel) { return document.querySelector(sel); };

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    sec = Math.floor(sec);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function current() { return queue[index] || null; }

  function loadData() {
    return fetch("songs.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load songs.json (" + r.status + ")");
        return r.json();
      })
      .then(function (json) {
        data = json;
        (data.songs || []).forEach(function (s) { byId[s.id] = s; });
        var hash = (location.hash || "").replace(/^#/, "");
        var params = new URLSearchParams(hash);
        var wantSong = params.get("song") || (hash.indexOf("=") < 0 ? hash : "");
        var wantList = params.get("list");
        var startList = (wantList && playlistById(wantList)) ? wantList : "all";
        setPlaylist(startList, false);
        if (wantSong && byId[wantSong]) {
          var i = queue.findIndex(function (s) { return s.id === wantSong; });
          if (i < 0) {
            setPlaylist("all", false);
            i = queue.findIndex(function (s) { return s.id === wantSong; });
          }
          if (i >= 0) select(i, false);
        } else {
          select(0, false);
        }
        renderTabs();
      });
  }

  function playlistById(id) {
    return (data.playlists || []).find(function (p) { return p.id === id; });
  }

  function setPlaylist(id, keepSong) {
    var pl = playlistById(id) || playlistById("all");
    activeList = pl.id;
    var keepId = keepSong && current() ? current().id : null;
    queue = (pl.songs || []).map(function (sid) { return byId[sid]; }).filter(Boolean);
    var i = keepId ? queue.findIndex(function (s) { return s.id === keepId; }) : 0;
    if (i < 0) i = 0;
    index = i;
    var note = $("#playlist-note");
    if (note) note.textContent = pl.description || "";
    renderTabs();
    renderList();
  }

  function renderTabs() {
    var nav = $("#playlist-tabs");
    if (!nav) return;
    nav.innerHTML = "";
    (data.playlists || []).forEach(function (pl) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", pl.id === activeList ? "true" : "false");
      b.textContent = pl.title;
      b.addEventListener("click", function () {
        setPlaylist(pl.id, true);
        select(index, false);
      });
      nav.appendChild(b);
    });
  }

  function renderList() {
    var ul = $("#track-list");
    if (!ul) return;
    ul.innerHTML = "";
    queue.forEach(function (s, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "track";
      btn.setAttribute("aria-current", i === index ? "true" : "false");
      btn.innerHTML =
        '<img src="' + s.artwork + '" width="72" height="40" alt="">' +
        '<span><p class="t-title"></p><p class="t-meta"></p></span>' +
        '<span class="t-dur">' + fmt(s.duration) + "</span>";
      btn.querySelector(".t-title").textContent = s.title;
      btn.querySelector(".t-meta").textContent = s.passage + " · " + s.translation;
      btn.addEventListener("click", function () { select(i, true); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function resetPlayCount() {
    playedSec = 0;
    counted = false;
    lastTime = 0;
    countedSongId = null;
  }

  function select(i, play) {
    if (!queue.length) return;
    index = (i + queue.length) % queue.length;
    var s = current();
    resetPlayCount();
    fading = false;
    audio.volume = baseVolume;
    /* Swap src on the same element. Do not create a new <audio>. */
    audio.src = s.src;
    updateNowPlaying(s);
    renderList();
    setHash(s);
    setupMediaSession(s);
    if (play) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function setHash(s) {
    var next = "#list=" + encodeURIComponent(activeList) + "&song=" + encodeURIComponent(s.id);
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function updateNowPlaying(s) {
    function setText(sel, t) {
      var el = $(sel);
      if (el) el.textContent = t;
    }
    setText("#now-title", s.title);
    setText("#now-passage", s.passage + " · " + s.translation);
    setText("#dock-title", s.title);
    setText("#dock-passage", s.passage);
    ["#now-art img", "#dock-art"].forEach(function (sel) {
      var img = $(sel);
      if (img) { img.src = s.artwork; img.alt = s.title; }
    });
    var yt = $("#now-yt");
    if (yt) {
      yt.href = s.youtube;
      yt.textContent = "Watch this passage on YouTube ›";
    }
    document.title = s.title + " · Listen · Singing Scripture";
  }

  function playPause() {
    if (!audio.src) select(index, true);
    else if (audio.paused) audio.play();
    else audio.pause();
  }

  function next() { select(index + 1, true); }
  function prev() {
    if (audio.currentTime > 3) { audio.currentTime = 0; lastTime = 0; return; }
    select(index - 1, true);
  }

  function syncPlayButtons() {
    var playing = !audio.paused && !audio.ended;
    ["#btn-play", "#dock-play"].forEach(function (sel) {
      var b = $(sel);
      if (!b) return;
      b.textContent = playing ? "❚❚" : "▶";
      b.setAttribute("aria-label", playing ? "Pause" : "Play");
    });
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }

  function maybeCountPlay(s) {
    if (!s || counted) return;
    if (playedSec < 30) return;
    counted = true;
    countedSongId = s.id;
    try {
      if (window.goatcounter && typeof window.goatcounter.count === "function") {
        window.goatcounter.count({
          path: "play/" + s.slug,
          title: s.title,
          event: true
        });
      }
    } catch (err) { /* script blocked or unavailable — do not throw */ }
  }

  function onTimeUpdate() {
    var cur = audio.currentTime || 0;
    var dur = audio.duration || (current() && current().duration) || 0;
    var s = current();

    /* Replay of the same track from the start: allow a new count after 30s. */
    if (lastTime > 2 && cur < 1) resetPlayCount();

    /* Accumulate only small forward deltas so seeking does not count. */
    if (!audio.paused && lastTime >= 0) {
      var delta = cur - lastTime;
      if (delta > 0 && delta < 2) playedSec += delta;
    }
    lastTime = cur;
    maybeCountPlay(s);

    ["#time-cur", "#dock-cur"].forEach(function (sel) { var el = $(sel); if (el) el.textContent = fmt(cur); });
    ["#time-dur", "#dock-dur"].forEach(function (sel) { var el = $(sel); if (el) el.textContent = fmt(dur); });
    ["#seek", "#dock-seek"].forEach(function (sel) {
      var el = $(sel);
      if (!el || el.dataset.dragging) return;
      el.max = String(dur || 0);
      el.value = String(cur);
    });
    if (navigator.mediaSession && navigator.mediaSession.setPositionState && dur) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(cur, dur)
        });
      } catch (err) {}
    }
    tickSleep();
  }

  function tickSleep() {
    var label = $("#sleep-left");
    if (!sleepUntil) {
      if (label) label.textContent = "";
      return;
    }
    var left = Math.max(0, sleepUntil - Date.now());
    if (label) label.textContent = left ? ("ends in " + fmt(left / 1000)) : "";
    if (left <= 8000 && left > 0 && !audio.paused) {
      fading = true;
      audio.volume = Math.max(0, baseVolume * (left / 8000));
    }
    if (left <= 0) {
      sleepUntil = 0;
      fading = false;
      audio.pause();
      audio.volume = baseVolume;
      var sel = $("#sleep-timer");
      if (sel) sel.value = "0";
      if (label) label.textContent = "timer ended";
    }
  }

  function setSleep(minutes) {
    sleepUntil = minutes ? Date.now() + minutes * 60 * 1000 : 0;
    fading = false;
    audio.volume = baseVolume;
    tickSleep();
  }

  function setupMediaSession(s) {
    if (!("mediaSession" in navigator)) return;
    var art = new URL(s.artwork, location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title,
      artist: "Singing Scripture",
      album: s.passage,
      artwork: [{ src: art, sizes: "640x360", type: "image/webp" }]
    });
    var bind = function (action, fn) {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (err) {}
    };
    bind("play", function () { audio.play(); });
    bind("pause", function () { audio.pause(); });
    bind("previoustrack", prev);
    bind("nexttrack", next);
    bind("stop", function () { audio.pause(); audio.currentTime = 0; });
    bind("seekbackward", function (d) {
      audio.currentTime = Math.max(0, audio.currentTime - ((d && d.seekOffset) || 10));
      lastTime = audio.currentTime;
    });
    bind("seekforward", function (d) {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + ((d && d.seekOffset) || 10));
      lastTime = audio.currentTime;
    });
    bind("seekto", function (d) {
      if (d && isFinite(d.seekTime)) {
        audio.currentTime = d.seekTime;
        lastTime = audio.currentTime;
      }
    });
  }

  function wireSeek(el) {
    if (!el) return;
    el.addEventListener("pointerdown", function () { el.dataset.dragging = "1"; });
    el.addEventListener("pointerup", function () { delete el.dataset.dragging; });
    el.addEventListener("change", function () {
      audio.currentTime = Number(el.value) || 0;
      lastTime = audio.currentTime;
      delete el.dataset.dragging;
    });
    el.addEventListener("input", function () {
      var t = Number(el.value) || 0;
      ["#time-cur", "#dock-cur"].forEach(function (sel) { var n = $(sel); if (n) n.textContent = fmt(t); });
    });
  }

  function init() {
    wireSeek($("#seek"));
    wireSeek($("#dock-seek"));
    $("#btn-play").addEventListener("click", playPause);
    $("#dock-play").addEventListener("click", playPause);
    $("#btn-next").addEventListener("click", next);
    $("#dock-next").addEventListener("click", next);
    $("#btn-prev").addEventListener("click", prev);
    $("#dock-prev").addEventListener("click", prev);
    $("#volume").addEventListener("input", function (e) {
      baseVolume = Number(e.target.value);
      if (!fading) audio.volume = baseVolume;
    });
    audio.volume = baseVolume;
    $("#volume").value = String(baseVolume);
    $("#sleep-timer").addEventListener("change", function (e) {
      setSleep(Number(e.target.value) || 0);
    });

    audio.addEventListener("play", syncPlayButtons);
    audio.addEventListener("pause", syncPlayButtons);
    audio.addEventListener("ended", function () {
      if (sleepUntil && Date.now() >= sleepUntil) return;
      /* Advance immediately on the same element — no timer. */
      next();
    });
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onTimeUpdate);
    audio.addEventListener("error", function () {
      var s = current();
      var note = $("#player-error");
      if (note) {
        note.hidden = false;
        note.textContent = "This song could not be loaded" + (s ? " (" + s.title + ")" : "") + ".";
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); playPause(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); prev(); }
    });

    loadData().catch(function (err) {
      var note = $("#player-error");
      if (note) { note.hidden = false; note.textContent = String(err.message || err); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
