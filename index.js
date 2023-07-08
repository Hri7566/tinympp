require("dotenv").config();
const EventEmitter = require("events");
const ws = require("ws");
const fs = require("fs");
const crypto = require("crypto");
const port = process.env.PORT || 3000;

const wss = new ws.Server({ port });

let channel = {
  ppl: {},
  sendArray: (msgs, excludeIDs) => {
    for (const ws of wss.clients) {
      if (typeof ws.user == "undefined" || typeof ws.sendArray == "undefined")
        continue;
      if (typeof ws.user.id == "undefined") continue;
      if (Array.isArray(excludeIDs)) {
        if (excludeIDs.includes(ws.user.id)) {
          continue;
        }
      }
      ws.sendArray(msgs);
    }
  },
  settings: {
    chat: true,
    color: "#000000",
    color2: "#000000",
    crownsolo: false,
    lobby: true,
    visible: true,
  },
  chatHistory: [],
};

let userData = {};

try {
  userData = JSON.parse(fs.readFileSync("users.json").toString());
} catch (err) {
  userData = {};
}

const saveData = () => fs.writeFileSync("users.json", JSON.stringify(userData));
const setUser = (user) => {
  // console.log("setting user");
  userData[user._id] = user;
  saveData();
};
const getUser = (_id) => userData[_id];
const verifyColor = (color) =>
  typeof color == "string" ? /^\#[0-9a-f]{6}/.test(color) == true : false;
const IPtoID = (ip) =>
  crypto
    .createHash("sha-256")
    .update(process.env.SALT)
    .update(ip)
    .update(process.env.SALT)
    .digest("hex")
    .substring(0, 24);

const IDtoColor = (_id) =>
  "#" +
  crypto
    .createHash("sha-256")
    .update(process.env.SALT)
    .update(_id)
    .update(process.env.SALT)
    .update("color")
    .digest("hex")
    .substring(0, 6);

wss.on("connection", (ws, req) => {
  ws.on("close", () => {
    ws.evt.emit("bye");
  });

  ws.evt = new EventEmitter();

  ws.on("close", () => {
    ws.emit("bye");
  });

  ws.on("message", (data, isBinary) => {
    try {
      const msgs = JSON.parse(data);
      for (const msg of msgs) {
        if (!ws.loggedIn && msg.m !== "hi") return;
        ws.evt.emit(msg.m, msg);
      }
    } catch (err) {
      console.error(err);
    }
  });

  ws.loggedIn = false;
  ws.ip =
    req.socket.remoteAddress == "127.0.0.1"
      ? req.headers["x-forwareded-for"] || req.socket.remoteAddress
      : req.socket.remoteAddress;

  ws.sendArray = (msgs) => ws.send(JSON.stringify(msgs));
  ws.user = {
    _id: IPtoID(ws.ip),
    name: "Anonymous",
    id: crypto.randomUUID(),
    color: IDtoColor(IPtoID(ws.ip)),
  };

  let closed = false;

  for (const client of wss.clients) {
    if (client.user) {
      if (client.user._id == ws.user._id && client !== ws) {
        ws.sendArray([
          {
            m: "notification",
            id: "notice",
            title: "Notice",
            text: "You are already connected to the server on this IP.",
            target: "#volume",
            duration: 7000,
          },
          {
            m: "notification",
            id: "script",
            target: "#names",
            duration: 1,
            class: "short",
            html: `<script>MPP.client.stop()</script>`,
          },
        ]);
        ws.close();
        closed = true;
        return;
      }
    }
  }

  if (closed) return;

  let savedUser = getUser(ws.user._id);
  typeof savedUser !== "undefined" ? (ws.user = savedUser) : setUser(ws.user);
  // console.log(JSON.stringify(userData));

  ws.evt.on("hi", (msg) => {
    // console.log("Received hi message");
    ws.loggedIn = true;
    ws.sendArray([
      {
        m: "hi",
        motd: "tinympp",
        u: {
          _id: ws.user._id,
          name: ws.user.name,
          id: ws.user.id,
        },
      },
    ]);
    ws.sendPing();
  });

  ws.evt.on("bye", (msg) => {
    delete channel.ppl[ws.user._id];
    channel.sendArray([
      {
        m: "bye",
        p: ws.user.id,
      },
    ]);
    if (ws.readyState !== ws.CLOSED) ws.close();
  });

  ws.evt.on("a", (msg) => {
    const m = {
      m: "a",
      a: msg.message,
      p: {
        _id: ws.user._id,
        name: ws.user.name,
        color: ws.user.color,
        id: ws.user.id,
      },
      t: Date.now(),
    };
    channel.sendArray([m]);
    channel.chatHistory.push(m);
  });

  ws.sendPing = (msg) => {
    if (!msg) msg = {};
    ws.sendArray([
      {
        m: "t",
        t: Date.now(),
        e: typeof msg.e == "number" && !isNaN(msg.e) ? msg.e : undefined,
      },
    ]);
  };

  ws.evt.on("ch", (msg) => {
    channel.ppl[ws.user._id] = ws.user;
    ws.sendArray([
      {
        m: "ch",
        ch: {
          _id: "lobby",
          settings: channel.settings,
        },
        ppl: Object.values(channel.ppl),
        p: ws.user.id,
      },
      {
        m: "c",
        c: channel.chatHistory.slice(
          channel.chatHistory.length - 50,
          channel.chatHistory.length
        ),
      },
      {
        m: "notification",
        id: "welcome",
        title: "Welcome!",
        text: "Welcome to tinympp.",
        duration: 7000,
        target: "#piano",
      },
    ]);

    channel.sendArray([
      {
        m: "p",
        id: ws.user.id,
        name: ws.user.name,
        color: ws.user.color,
        _id: ws.user._id,
      },
    ]);
  });

  ws.evt.on("userset", (msg) => {
    if (typeof msg.set !== "object") return;
    if (
      typeof msg.set.name == "undefined" &&
      typeof msg.set.color == "undefined"
    )
      return;
    typeof msg.set.name !== "undefined" ? (ws.user.name = msg.set.name) : 0;
    typeof msg.set.color !== "undefined"
      ? verifyColor(msg.set.color)
        ? (ws.user.color = msg.set.color)
        : 0
      : 0;
    setUser(ws.user);
    channel.sendArray([
      {
        m: "p",
        name: ws.user.name,
        color: ws.user.color,
        id: ws.user.id,
        _id: ws.user._id,
      },
    ]);
  });

  ws.evt.on("m", (msg) => {
    if (typeof msg.x !== "number" && typeof msg.x !== "string") return;
    if (typeof msg.y !== "number" && typeof msg.y !== "string") return;
    channel.sendArray(
      [{ m: "m", x: msg.x, y: msg.y, id: ws.user.id }]
      // [ws.user.id]
    );
  });

  ws.evt.on("n", (msg) => {
    if (!msg.n) return;
    if (!Array.isArray(msg.n)) return;
    for (let n of msg.n) {
      if (!n.d) n.d = 0;
      if (!n.v) n.v = 1;
    }
    channel.sendArray(
      [
        {
          m: "n",
          t: msg.t || 1000,
          n: msg.n,
          p: ws.user.id,
        },
      ],
      [ws.user.id]
    );
  });

  ws.evt.on("t", (msg) => {
    ws.sendPing(msg);
  });
});

console.log("Listening on port " + port);
