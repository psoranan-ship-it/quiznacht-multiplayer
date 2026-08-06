(function () {
  "use strict";

  // TODO: nach dem Google-Cloud-Setup hier die OAuth-Client-ID eintragen.
  var CLIENT_ID = "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com";

  var CATS = [
    {
      id: "tech", name: "Technik & Games", icon: "🎮", color: "var(--cat-tech)",
      questions: [
        { value: 100, q: "Welches Unternehmen entwickelte das Betriebssystem Windows?", options: ["Apple", "Microsoft", "Google", "IBM"], correct: 1 },
        { value: 200, q: "Welcher Publisher steht hinter „The Legend of Zelda“?", options: ["Sony", "Sega", "Nintendo", "Capcom"], correct: 2 },
        { value: 300, q: "Welche Programmiersprache wurde von Guido van Rossum geschaffen?", options: ["Java", "Python", "Ruby", "Rust"], correct: 1 },
        { value: 400, q: "In welchem Jahr wurde das erste iPhone vorgestellt?", options: ["2005", "2006", "2007", "2009"], correct: 2 }
      ]
    },
    {
      id: "film", name: "Film & Musik", icon: "🎬", color: "var(--cat-film)",
      questions: [
        { value: 100, q: "Welche Band singt „Bohemian Rhapsody“?", options: ["The Beatles", "Queen", "Pink Floyd", "Genesis"], correct: 1 },
        { value: 200, q: "Wer spielt Iron Man im Marvel Cinematic Universe?", options: ["Chris Evans", "Chris Hemsworth", "Robert Downey Jr.", "Mark Ruffalo"], correct: 2 },
        { value: 300, q: "Welcher Regisseur drehte „Inception“ und „Interstellar“?", options: ["Steven Spielberg", "Christopher Nolan", "Denis Villeneuve", "James Cameron"], correct: 1 },
        { value: 400, q: "Welches Michael-Jackson-Album ist das meistverkaufte Album aller Zeiten?", options: ["Bad", "Dangerous", "Thriller", "Off the Wall"], correct: 2 }
      ]
    },
    {
      id: "sport", name: "Sport", icon: "⚽", color: "var(--cat-sport)",
      questions: [
        { value: 100, q: "Wie viele Spieler stehen bei einer Fußballmannschaft inkl. Torwart auf dem Feld?", options: ["9", "10", "11", "12"], correct: 2 },
        { value: 200, q: "In welcher Stadt fanden die Olympischen Sommerspiele 2024 statt?", options: ["Tokio", "London", "Paris", "Los Angeles"], correct: 2 },
        { value: 300, q: "Wie oft wurde Deutschland Fußball-Weltmeister (Stand 2024)?", options: ["2-mal", "3-mal", "4-mal", "5-mal"], correct: 2 },
        { value: 400, q: "Welcher Sport wird bei den „Grand Slams“ Wimbledon und Roland Garros gespielt?", options: ["Golf", "Tennis", "Cricket", "Badminton"], correct: 1 }
      ]
    },
    {
      id: "allg", name: "Allgemeinwissen", icon: "🌍", color: "var(--cat-allg)",
      questions: [
        { value: 100, q: "Wie viele Kontinente gibt es (nach gängiger Schuldefinition)?", options: ["5", "6", "7", "8"], correct: 2 },
        { value: 200, q: "Welches ist das flächenmäßig größte Land der Welt?", options: ["Kanada", "China", "USA", "Russland"], correct: 3 },
        { value: 300, q: "Wie viele Bundesländer hat Deutschland?", options: ["13", "14", "15", "16"], correct: 3 },
        { value: 400, q: "Welches chemische Element hat das Symbol „Au“?", options: ["Silber", "Aluminium", "Gold", "Argon"], correct: 2 }
      ]
    }
  ];

  var AVATAR_COLORS = ["#0f8fb0", "#c22672", "#1f7a52", "#c15a00", "#7b4fd1", "#c94040", "#2c5fc9", "#0a9e7a"];
  var SHAPES = ["▲", "◆", "●", "■"];
  var SHAPE_VARS = ["var(--cat-tech)", "var(--cat-film)", "var(--cat-sport)", "var(--cat-allg)"];
  var TIME_LIMIT_MS = 20000;
  var POLL_MS = 1500;
  var TICK_MS = 300;
  var TIMEOUT_GRACE_MS = 3000;   // spectators may resolve an unanswered question this long after the active player could have
  var ADVANCE_GRACE_MS = 15000;  // safety net: anyone may advance the turn if the active player never clicks "Weiter"

  var screenEl = document.getElementById("screen");
  var scoreboardSlot = document.getElementById("scoreboard-slot");
  var statusEl = document.getElementById("status-line");

  var myId = getOrCreateMyId();
  var fileId = null;
  var localState = null;
  var pollHandle = null;
  var tickHandle = null;
  var busy = false; // true while a write is in flight, to avoid piling up mutate() calls

  function getOrCreateMyId() {
    var key = "quiznacht_my_id";
    var id = localStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : "p-" + Date.now() + "-" + Math.random().toString(16).slice(2));
      localStorage.setItem(key, id);
    }
    return id;
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function initials(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.className = "status-line" + (isError ? " error" : "");
  }

  function buildEmptyBoard() {
    return CATS.map(function (c) {
      return { questions: c.questions.map(function () { return { answered: false, wonBy: null }; }) };
    });
  }

  function parseRoomInput(raw) {
    raw = (raw || "").trim();
    if (!raw) return null;
    try {
      var u = new URL(raw);
      var fromQuery = u.searchParams.get("room");
      if (fromQuery) return fromQuery;
    } catch (e) { /* not a URL, fall through */ }
    return raw;
  }

  function roomLink(id) {
    return location.origin + location.pathname + "?room=" + encodeURIComponent(id);
  }

  // ---------- Drive-backed actions ----------
  function withBusy(promise) {
    busy = true;
    return promise.then(function (result) {
      busy = false;
      return result;
    }).catch(function (err) {
      busy = false;
      setStatus(err.message, true);
      throw err;
    });
  }

  function joinAsPlayer(name) {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (s.screen !== "lobby") return null;
      if (s.players.some(function (p) { return p.id === myId; })) return null;
      if (s.players.length >= 8) return null;
      s.players.push({ id: myId, name: name, color: AVATAR_COLORS[s.players.length % AVATAR_COLORS.length], score: 0 });
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function startGame() {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (myId !== s.hostId || s.players.length < 2 || s.screen !== "lobby") return null;
      s.screen = "board";
      s.currentPlayer = 0;
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function pickQuestion(catIdx, row) {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (s.screen !== "board" || !s.players.length) return null;
      if (s.players[s.currentPlayer].id !== myId) return null;
      if (s.board[catIdx].questions[row].answered) return null;
      s.screen = "question";
      s.active = { cat: catIdx, row: row, deadline: Date.now() + TIME_LIMIT_MS, locked: false, chosenIdx: null, resolvedAt: null };
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function resolveAnswer(chosenIdx) {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (s.screen !== "question" || !s.active || s.active.locked) return null;
      var cat = CATS[s.active.cat];
      var q = cat.questions[s.active.row];
      var correct = chosenIdx === q.correct;
      s.active.locked = true;
      s.active.chosenIdx = chosenIdx;
      s.active.resolvedAt = Date.now();
      s.board[s.active.cat].questions[s.active.row].answered = true;
      s.board[s.active.cat].questions[s.active.row].wonBy = correct ? s.players[s.currentPlayer].id : null;
      if (correct) s.players[s.currentPlayer].score += q.value;
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function boardCleared(board) {
    return board.every(function (cat) { return cat.questions.every(function (q) { return q.answered; }); });
  }

  function continueTurn() {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (s.screen !== "question" || !s.active || !s.active.locked) return null;
      s.active = null;
      if (boardCleared(s.board)) {
        s.screen = "end";
      } else {
        s.screen = "board";
        s.currentPlayer = (s.currentPlayer + 1) % s.players.length;
      }
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function playAgain() {
    if (busy) return;
    withBusy(DriveStore.mutate(fileId, function (s) {
      if (myId !== s.hostId) return null;
      s.players.forEach(function (p) { p.score = 0; });
      s.board = buildEmptyBoard();
      s.currentPlayer = 0;
      s.active = null;
      s.screen = "board";
      return s;
    })).then(function (s) { localState = s; render(); }).catch(function () {});
  }

  function leaveRoom() {
    stopPolling();
    fileId = null;
    localState = null;
    history.pushState({}, "", location.pathname);
    renderLanding();
  }

  // ---------- Polling / ticking ----------
  function startPolling() {
    stopPolling();
    poll();
    pollHandle = setInterval(poll, POLL_MS);
    tickHandle = setInterval(tick, TICK_MS);
  }

  function stopPolling() {
    if (pollHandle) clearInterval(pollHandle);
    if (tickHandle) clearInterval(tickHandle);
    pollHandle = null;
    tickHandle = null;
  }

  function poll() {
    DriveStore.readState(fileId).then(function (s) {
      setStatus("");
      localState = s;
      render();
    }).catch(function (err) {
      setStatus(err.message, true);
    });
  }

  function tick() {
    if (!localState || localState.screen !== "question" || !localState.active) return;
    updateTimerBar();
    var remaining = localState.active.deadline - Date.now();
    if (!localState.active.locked) {
      var iAmActive = localState.players.length && localState.players[localState.currentPlayer].id === myId;
      if (remaining <= 0 && iAmActive) resolveAnswer(-1);
      else if (remaining <= -TIMEOUT_GRACE_MS) resolveAnswer(-1);
    } else if (localState.active.resolvedAt && Date.now() - localState.active.resolvedAt > ADVANCE_GRACE_MS) {
      continueTurn();
    }
  }

  function updateTimerBar() {
    var fill = document.getElementById("timer-fill");
    if (!fill || !localState.active) return;
    var remaining = localState.active.deadline - Date.now();
    var pct = Math.max(0, Math.min(1, remaining / TIME_LIMIT_MS)) * 100;
    fill.style.width = pct + "%";
  }

  // ---------- Rendering ----------
  function render() {
    renderScoreboard();
    if (!localState) { renderConnecting(); return; }
    if (localState.screen === "lobby") renderLobby();
    else if (localState.screen === "board") renderBoard();
    else if (localState.screen === "question") renderQuestion();
    else if (localState.screen === "end") renderEnd();
  }

  function renderScoreboard() {
    if (!localState || localState.screen === "lobby" || localState.players.length === 0) {
      scoreboardSlot.innerHTML = "";
      return;
    }
    var html = '<div class="scoreboard">';
    localState.players.forEach(function (p, i) {
      var active = (localState.screen === "board" || localState.screen === "question") && i === localState.currentPlayer;
      html += '<div class="score-chip' + (active ? " active" : "") + '">' +
        '<div class="avatar" style="background:' + p.color + '">' + esc(initials(p.name)) + '</div>' +
        '<div><div class="name">' + esc(p.name) + (p.id === myId ? " (du)" : "") + (active ? '<div class="turn-flag">Am Zug</div>' : '') + '</div>' +
        '<div class="pts">' + p.score + ' Pkt.</div></div>' +
        '</div>';
    });
    html += '</div>';
    scoreboardSlot.innerHTML = html;
  }

  function renderConnecting() {
    screenEl.innerHTML = '<div class="card"><p class="muted">Verbinde mit dem Spiel…</p></div>';
  }

  // ---------- Landing (no room yet) ----------
  function renderLanding() {
    var params = new URLSearchParams(location.search);
    var prefill = params.get("room") || "";

    screenEl.innerHTML =
      '<div class="card">' +
      '<h2>Neues Spiel erstellen</h2>' +
      '<p class="muted" style="margin-top:6px;">Du wirst Gastgeber:in und bekommst einen Link zum Teilen.</p>' +
      '<div class="setup-actions" style="justify-content:flex-start;margin-top:16px;">' +
      '<button type="button" class="btn btn-primary" id="create-btn">Spiel erstellen &rarr;</button>' +
      '</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>Spiel beitreten</h2>' +
      '<p class="muted" style="margin-top:6px;">Link oder Code von der gastgebenden Person einfügen.</p>' +
      '<form class="setup-form" id="join-form">' +
      '<input type="text" id="room-input" placeholder="Link oder Code&hellip;" value="' + esc(prefill) + '" autocomplete="off" />' +
      '<button type="submit" class="btn btn-primary">Beitreten</button>' +
      '</form>' +
      '</div>';

    document.getElementById("create-btn").addEventListener("click", function () {
      setStatus("Google-Anmeldung…");
      DriveStore.signIn().then(function () {
        setStatus("Spiel wird angelegt…");
        var initial = {
          version: 0,
          screen: "lobby",
          hostId: myId,
          players: [],
          currentPlayer: 0,
          board: buildEmptyBoard(),
          active: null,
          updatedAt: Date.now(),
          updatedBy: myId
        };
        return DriveStore.createRoom("Quiznacht – Spiel " + new Date().toLocaleString("de-DE"), initial);
      }).then(function (id) {
        fileId = id;
        history.pushState({}, "", roomLink(id));
        setStatus("");
        startPolling();
      }).catch(function (err) { setStatus(err.message, true); });
    });

    document.getElementById("join-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = parseRoomInput(document.getElementById("room-input").value);
      if (!id) return;
      setStatus("Google-Anmeldung…");
      DriveStore.signIn().then(function () {
        setStatus("Prüfe Zugriff…");
        return DriveStore.readState(id);
      }).then(function (s) {
        fileId = id;
        localState = s;
        history.pushState({}, "", roomLink(id));
        setStatus("");
        startPolling();
        render();
      }).catch(function (err) { setStatus(err.message, true); });
    });
  }

  // ---------- Lobby ----------
  function renderLobby() {
    var iAmPlayer = localState.players.some(function (p) { return p.id === myId; });
    var listHtml = localState.players.map(function (p) {
      return '<li class="player-chip">' +
        '<span class="avatar" style="background:' + p.color + '">' + esc(initials(p.name)) + '</span>' +
        esc(p.name) + (p.id === localState.hostId ? '<span class="host-flag">Host</span>' : "") +
        '</li>';
    }).join("");

    var joinFormHtml = iAmPlayer ? "" :
      '<form class="setup-form" id="add-form">' +
      '<input type="text" id="name-input" placeholder="Dein Name&hellip;" maxlength="18" autocomplete="off" />' +
      '<button type="submit" class="btn btn-primary">Beitreten</button>' +
      '</form>';

    var iAmHost = myId === localState.hostId;
    var startBtnHtml = iAmHost ?
      '<button type="button" class="btn btn-primary" id="start-btn" ' + (localState.players.length < 2 ? "disabled" : "") + '>Spiel starten &rarr;</button>' :
      '<span class="muted">Warte, bis die Gastgeber:in startet&hellip;</span>';

    screenEl.innerHTML =
      '<div class="card">' +
      '<h2>Wer spielt mit?</h2>' +
      '<p class="muted" style="margin-top:6px;">Teile den Link, damit alle beitreten können.</p>' +
      '<div class="room-box"><code>' + esc(roomLink(fileId)) + '</code>' +
      '<button type="button" class="btn btn-ghost" id="copy-link-btn">Link kopieren</button></div>' +
      joinFormHtml +
      '<ul class="player-list">' + listHtml + '</ul>' +
      (localState.players.length < 2 ? '<p class="setup-hint muted">Mindestens 2 Spieler:innen nötig, bevor gestartet werden kann.</p>' : '') +
      '<div class="setup-actions">' + startBtnHtml + '</div>' +
      '</div>';

    document.getElementById("copy-link-btn").addEventListener("click", function () {
      var link = roomLink(fileId);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(function () { setStatus("Link kopiert."); });
      } else {
        setStatus(link);
      }
    });

    if (!iAmPlayer) {
      document.getElementById("add-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var input = document.getElementById("name-input");
        var name = input.value.trim();
        if (!name) return;
        joinAsPlayer(name);
      });
    }
    if (iAmHost) {
      var startBtn = document.getElementById("start-btn");
      if (startBtn) startBtn.addEventListener("click", startGame);
    }
  }

  // ---------- Board ----------
  function renderBoard() {
    var iAmPlayer = localState.players.some(function (p) { return p.id === myId; });
    var myTurn = iAmPlayer && localState.players[localState.currentPlayer].id === myId;

    var headHtml = CATS.map(function (c) {
      return '<div class="board-head" style="background:' + c.color + '"><span class="icon">' + c.icon + '</span>' + esc(c.name) + '</div>';
    }).join("");

    var rows = "";
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < CATS.length; c++) {
        var qState = localState.board[c].questions[r];
        var val = CATS[c].questions[r].value;
        if (qState.answered) {
          var winner = qState.wonBy ? localState.players.find(function (p) { return p.id === qState.wonBy; }) : null;
          rows += '<button class="cell" disabled>' +
            (winner ? '<span class="won-avatar" style="background:' + winner.color + '">' + esc(initials(winner.name)) + '</span>' : '&mdash;') +
            '</button>';
        } else if (myTurn) {
          rows += '<button class="cell" data-cat="' + c + '" data-row="' + r + '" style="color:' + CATS[c].color + '">' + val + '</button>';
        } else {
          rows += '<button class="cell not-my-turn" disabled style="color:' + CATS[c].color + '">' + val + '</button>';
        }
      }
    }

    var turnLine = !iAmPlayer
      ? '<div class="spectator-wrap"><span class="spectator-badge">Du bist Zuschauer:in &mdash; das Spiel läuft schon</span></div>'
      : '<div class="q-turn">' + (myTurn ? "Du bist am Zug &mdash; wähle eine Kategorie" : "Am Zug: <strong>" + esc(localState.players[localState.currentPlayer].name) + "</strong>") + '</div>';

    screenEl.innerHTML =
      turnLine +
      '<div class="board-scroll"><div class="board">' + headHtml + rows + '</div></div>';

    if (myTurn) {
      screenEl.querySelectorAll(".cell[data-cat]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          pickQuestion(parseInt(btn.getAttribute("data-cat"), 10), parseInt(btn.getAttribute("data-row"), 10));
        });
      });
    }
  }

  // ---------- Question ----------
  function renderQuestion() {
    var cat = CATS[localState.active.cat];
    var q = cat.questions[localState.active.row];
    var player = localState.players[localState.currentPlayer];
    var iAmPlayer = localState.players.some(function (p) { return p.id === myId; });
    var myTurn = iAmPlayer && player.id === myId;
    var locked = localState.active.locked;
    var chosenIdx = localState.active.chosenIdx;

    var answersHtml = q.options.map(function (opt, i) {
      var classes = "answer-btn";
      if (locked) {
        if (i === q.correct) classes += " correct";
        else classes += " dim";
        if (i === chosenIdx && i !== q.correct) classes += " wrong";
      }
      return '<button class="' + classes + '" data-idx="' + i + '" style="background:' + SHAPE_VARS[i] + '" ' + (locked || !myTurn ? "disabled" : "") + '>' +
        '<span class="shape">' + SHAPES[i] + '</span><span>' + esc(opt) + '</span></button>';
    }).join("");

    var resultHtml = "";
    var resultColor = "";
    if (locked) {
      if (chosenIdx === -1) { resultHtml = "Zeit abgelaufen &ndash; keine Punkte."; resultColor = "var(--ink-dim)"; }
      else if (chosenIdx === q.correct) { resultHtml = "Richtig! +" + q.value + " Punkte für " + esc(player.name); resultColor = "var(--cat-sport)"; }
      else { resultHtml = "Leider falsch."; resultColor = "var(--cat-film)"; }
    }

    var actionsHtml = "";
    if (locked) {
      actionsHtml = myTurn
        ? '<button class="btn btn-primary" id="continue-btn">Weiter</button>'
        : '<span class="muted">Warte auf ' + esc(player.name) + '&hellip;</span>';
    }

    screenEl.innerHTML =
      '<div class="card question-wrap">' +
      '<div class="q-meta">' +
      '<span class="q-cat-badge" style="background:' + cat.color + '">' + cat.icon + ' ' + esc(cat.name) + '</span>' +
      '<span class="q-value">' + q.value + ' Punkte</span>' +
      '</div>' +
      '<div class="q-turn">' + (myTurn ? "Du bist am Zug" : (iAmPlayer ? "Am Zug: <strong>" + esc(player.name) + "</strong>" : '<span class="spectator-badge">Zuschauer:in</span>')) + '</div>' +
      '<div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>' +
      '<div class="q-text">' + esc(q.q) + '</div>' +
      '<div class="answers" id="answers">' + answersHtml + '</div>' +
      '<div class="q-result" id="q-result" style="color:' + resultColor + '">' + resultHtml + '</div>' +
      '<div class="q-actions" id="q-actions">' + actionsHtml + '</div>' +
      '</div>';

    updateTimerBar();

    if (myTurn && !locked) {
      screenEl.querySelectorAll(".answer-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          resolveAnswer(parseInt(btn.getAttribute("data-idx"), 10));
        });
      });
    }
    if (myTurn && locked) {
      var continueBtn = document.getElementById("continue-btn");
      if (continueBtn) continueBtn.addEventListener("click", continueTurn);
    }
  }

  // ---------- End ----------
  function renderEnd() {
    var iAmHost = myId === localState.hostId;
    var ranked = localState.players.slice().sort(function (a, b) { return b.score - a.score; });
    var medals = ["🥇", "🥈", "🥉"];
    var listHtml = ranked.map(function (p, i) {
      return '<li>' +
        '<span class="rank">' + (medals[i] || (i + 1)) + '</span>' +
        '<span class="avatar" style="background:' + p.color + '">' + esc(initials(p.name)) + '</span>' +
        '<span class="pname">' + esc(p.name) + '</span>' +
        '<span class="pscore">' + p.score + '</span>' +
        '</li>';
    }).join("");

    screenEl.innerHTML =
      '<div class="card">' +
      '<div class="end-title">🎉 ' + esc(ranked[0].name) + ' gewinnt!</div>' +
      '<ul class="podium">' + listHtml + '</ul>' +
      '<div class="end-actions">' +
      (iAmHost ? '<button class="btn btn-primary" id="replay-btn">Nochmal spielen</button>' : '<span class="muted">Warte, bis die Gastgeber:in neu startet&hellip;</span>') +
      '<button class="btn btn-ghost" id="leave-btn">Verlassen</button>' +
      '</div>' +
      '</div>';

    if (iAmHost) {
      document.getElementById("replay-btn").addEventListener("click", playAgain);
    }
    document.getElementById("leave-btn").addEventListener("click", leaveRoom);

    launchConfetti();
  }

  // ---------- Confetti ----------
  function launchConfetti() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    var canvas = document.getElementById("confetti-canvas");
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.scale(dpr, dpr);

    var colors = ["#0f8fb0", "#c22672", "#1f7a52", "#c15a00", "#ffb703"];
    var pieces = [];
    for (var i = 0; i < 130; i++) {
      pieces.push({
        x: Math.random() * window.innerWidth,
        y: -20 - Math.random() * window.innerHeight * 0.5,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        color: colors[i % colors.length],
        vy: 2 + Math.random() * 2.5,
        vx: -1 + Math.random() * 2,
        rot: Math.random() * Math.PI,
        vr: -0.15 + Math.random() * 0.3
      });
    }
    var start = Date.now();
    function frame() {
      var elapsed = Date.now() - start;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      pieces.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < 3800) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  function boot() {
    DriveStore.init(CLIENT_ID);
    renderLanding();
  }

  if (window.google && window.google.accounts) boot();
  else window.addEventListener("load", boot);
})();
