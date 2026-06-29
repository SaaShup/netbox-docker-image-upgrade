const fs = require("fs");
const net = require("net");
const path = require("path");
const tls = require("tls");

const mailDir = process.env.MAIL_DIR || "/mail";
const port = Number(process.env.SMTP_PORT || 587);
const cert = fs.readFileSync(process.env.SMTP_CERT || "/cert/cert.pem");
const key = fs.readFileSync(process.env.SMTP_KEY || "/cert/key.pem");

fs.mkdirSync(mailDir, { recursive: true });

function appendMessage({ from, recipients, data }) {
  const receivedAt = new Date().toISOString();
  const record = { receivedAt, from, recipients, size: Buffer.byteLength(data), data };
  fs.appendFileSync(path.join(mailDir, "messages.jsonl"), `${JSON.stringify(record)}\n`);
  fs.writeFileSync(path.join(mailDir, "latest.eml"), data);
}

function createSession(socket) {
  let input = "";
  let secure = false;
  let dataMode = false;
  let message = "";
  let activeSocket = socket;
  const state = { from: "", recipients: [] };

  function write(line) {
    activeSocket.write(`${line}\r\n`);
  }

  function resetMessage() {
    state.from = "";
    state.recipients = [];
    message = "";
    dataMode = false;
  }

  function handleLine(rawLine) {
    const line = rawLine.replace(/\r$/, "");
    if (dataMode) {
      if (line === ".") {
        appendMessage({ from: state.from, recipients: state.recipients, data: message });
        resetMessage();
        write("250 2.0.0 queued");
        return;
      }
      message += `${line.replace(/^\.\./, ".")}\r\n`;
      return;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
      write("250-integration-smtp");
      if (!secure) write("250-STARTTLS");
      write("250 PIPELINING");
      return;
    }
    if (upper === "STARTTLS") {
      write("220 2.0.0 Ready to start TLS");
      socket.removeAllListeners("data");
      const secureSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext: tls.createSecureContext({ cert, key }),
      });
      secure = true;
      bindSocket(secureSocket);
      return;
    }
    if (upper.startsWith("MAIL FROM:")) {
      state.from = line.slice("MAIL FROM:".length).trim();
      write("250 2.1.0 sender ok");
      return;
    }
    if (upper.startsWith("RCPT TO:")) {
      state.recipients.push(line.slice("RCPT TO:".length).trim());
      write("250 2.1.5 recipient ok");
      return;
    }
    if (upper === "DATA") {
      dataMode = true;
      message = "";
      write("354 End data with <CR><LF>.<CR><LF>");
      return;
    }
    if (upper === "RSET") {
      resetMessage();
      write("250 2.0.0 reset");
      return;
    }
    if (upper === "NOOP") {
      write("250 2.0.0 ok");
      return;
    }
    if (upper === "QUIT") {
      write("221 2.0.0 bye");
      activeSocket.end();
      return;
    }
    write("250 2.0.0 ok");
  }

  function bindSocket(boundSocket) {
    activeSocket = boundSocket;
    boundSocket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      let index;
      while ((index = input.indexOf("\n")) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        handleLine(line);
      }
    });
  }

  bindSocket(socket);
  write("220 integration-smtp ESMTP");
}

net.createServer(createSession).listen(port, "0.0.0.0", () => {
  console.log(`integration SMTP sink listening on ${port}`);
});
