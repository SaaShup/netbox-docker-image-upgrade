const homeHeadline = document.getElementById("homeHeadline");

function applyHomeConfig(config = {}) {
  const customerName = String(config.customer_name || "").trim();
  if (!homeHeadline || !customerName) return;
  homeHeadline.replaceChildren(
    document.createTextNode(customerName),
    document.createElement("br"),
    document.createTextNode("uses"),
    document.createElement("br"),
    document.createTextNode("Saashup"),
  );
}

fetch("/config", { headers: { Accept: "application/json" } })
  .then((response) => (response.ok ? response.json() : {}))
  .then(applyHomeConfig)
  .catch(() => {});
