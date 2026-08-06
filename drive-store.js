(function (global) {
  "use strict";

  var API = "https://www.googleapis.com/drive/v3";
  var UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  var SCOPE = "https://www.googleapis.com/auth/drive";

  var tokenClient = null;
  var accessToken = null;
  var tokenExpiresAt = 0;

  function init(clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: function () {}
    });
  }

  function signIn() {
    return new Promise(function (resolve, reject) {
      tokenClient.callback = function (resp) {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in * 1000);
          resolve();
        } else {
          reject(new Error((resp && resp.error) || "Anmeldung fehlgeschlagen"));
        }
      };
      tokenClient.error_callback = function (err) {
        reject(new Error((err && err.type) || "Anmeldung abgebrochen"));
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  function ensureToken() {
    if (accessToken && Date.now() < tokenExpiresAt - 30000) return Promise.resolve();
    return signIn();
  }

  function authFetch(url, opts, retry) {
    opts = opts || {};
    return ensureToken().then(function () {
      opts.headers = opts.headers || {};
      opts.headers["Authorization"] = "Bearer " + accessToken;
      return fetch(url, opts);
    }).then(function (res) {
      if (res.status === 401 && !retry) {
        accessToken = null;
        return authFetch(url, opts, true);
      }
      return res;
    });
  }

  function isSignedIn() {
    return !!accessToken;
  }

  function createRoom(roomName, initialState) {
    return authFetch(API + "/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: roomName, mimeType: "application/json" })
    }).then(function (res) {
      if (!res.ok) throw new Error("Konnte Spieldatei nicht anlegen (" + res.status + ")");
      return res.json();
    }).then(function (file) {
      return writeState(file.id, initialState).then(function () {
        return authFetch(API + "/files/" + file.id + "/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "anyone", role: "writer" })
        });
      }).then(function () {
        return file.id;
      });
    });
  }

  function readState(fileId) {
    return authFetch(API + "/files/" + fileId + "?alt=media").then(function (res) {
      if (!res.ok) throw new Error("Spiel nicht gefunden oder kein Zugriff (" + res.status + ")");
      return res.json();
    });
  }

  function writeState(fileId, state) {
    return authFetch(UPLOAD_API + "/files/" + fileId + "?uploadType=media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    }).then(function (res) {
      if (!res.ok) throw new Error("Speichern fehlgeschlagen (" + res.status + ")");
      return res.json();
    });
  }

  // Re-reads the latest state right before writing to keep the race window
  // small, then applies `mutator`. Return null/undefined from `mutator` to
  // skip writing (e.g. the precondition no longer holds).
  function mutate(fileId, mutator) {
    return readState(fileId).then(function (current) {
      var next = mutator(JSON.parse(JSON.stringify(current)));
      if (!next) return current;
      next.version = (current.version || 0) + 1;
      next.updatedAt = Date.now();
      return writeState(fileId, next).then(function () { return next; });
    });
  }

  global.DriveStore = {
    init: init,
    signIn: signIn,
    isSignedIn: isSignedIn,
    createRoom: createRoom,
    readState: readState,
    writeState: writeState,
    mutate: mutate
  };
})(window);
