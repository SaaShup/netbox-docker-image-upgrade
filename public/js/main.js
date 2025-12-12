const url=new URL(window.location.href);
const urlParams=new URLSearchParams(window.location.search);
const action=urlParams.get('action');
const select=document.getElementById("list");
var current = "c_";
var selected = localStorage.getItem("selected") || "";
if (localStorage.getItem("current_page")) current = localStorage.getItem("current_page");

document.getElementById('menu_create').onclick=function() {
  current="c_";
  localStorage.setItem("current_page", current);
  document.getElementById('create').style.display='block';
  document.getElementById('recreate').style.display='none';
  document.getElementById('restart').style.display='none';
  document.getElementById('delete').style.display='none';
  document.getElementById('menu_create').style.color='white';
  document.getElementById('menu_recreate').style.color='grey';
  document.getElementById('menu_restart').style.color='grey';
  document.getElementById('menu_delete').style.color='grey';
}

document.getElementById('menu_recreate').onclick=function() {
  current="u_";
  localStorage.setItem("current_page", current);
  document.getElementById('recreate').style.display='block';
  document.getElementById('restart').style.display='none';
  document.getElementById('create').style.display='none';
  document.getElementById('delete').style.display='none';
  document.getElementById('menu_recreate').style.color='white';
  document.getElementById('menu_create').style.color='grey';
  document.getElementById('menu_restart').style.color='grey';
  document.getElementById('menu_delete').style.color='grey';
}

document.getElementById('menu_restart').onclick=function() {
  current="r_";
  localStorage.setItem("current_page", current);
  document.getElementById('recreate').style.display='none';
  document.getElementById('restart').style.display='block';
  document.getElementById('create').style.display='none';
  document.getElementById('delete').style.display='none';
  document.getElementById('menu_recreate').style.color='grey';
  document.getElementById('menu_create').style.color='grey';
  document.getElementById('menu_restart').style.color='white';
  document.getElementById('menu_delete').style.color='grey';
}

document.getElementById('menu_delete').onclick=function() {
  current="d_";
  localStorage.setItem("current_page", current);
  document.getElementById('recreate').style.display='none';
  document.getElementById('restart').style.display='none';
  document.getElementById('create').style.display='none';
  document.getElementById('delete').style.display='block';
  document.getElementById('menu_recreate').style.color='grey';
  document.getElementById('menu_restart').style.color='grey';
  document.getElementById('menu_create').style.color='grey';
  document.getElementById('menu_delete').style.color='white';
}

if (action) {
  document.getElementById('notif').innerHTML = action;
  document.getElementById('notif').style.backgroundColor = 'lightgreen';
  setTimeout(function() {
    document.getElementById('notif').innerHTML = '<font color="grey">Welcome !</font>';
    document.getElementById('notif').style.backgroundColor = 'lightblue';
  }, 1000);
}

switch(current) {
  case "c_":  document.getElementById('menu_create').click();
              break;
  case "u_":  document.getElementById('menu_recreate').click();
              break;
  case "r_":  document.getElementById('menu_restart').click();
              break;
  case "d_":  document.getElementById('menu_delete').click();
              break;
}

url.searchParams.delete('action');
if (!window.__queryRemoved) {
  window.__queryRemoved = true;
  setTimeout(() => {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState(window.history.state, "", cleanUrl);
  }, 50);
}

if (action) document.getElementById('menu_' + action.split(' ')[0].toLowerCase()).click();

for (let i=0; i < localStorage.length; i++) {
  let key = localStorage.key(i);
  if ( !key.startsWith ("__")) continue;
  const value=localStorage.getItem(key);

  const option=document.createElement("option");
  option.value = key;
  key = key.replace(/^__/g, "");
  option.text = key;
  select.appendChild(option);
}

function remove() {
  document.getElementById('notif').innerHTML="Deleted";
  document.getElementById('notif').style.backgroundColor='lightred';
  const selectedIndex = select.selectedIndex;
  const id=select.value;
  const stored=localStorage.getItem(id);
  if ( !stored) return;
  localStorage.removeItem(id);
  select.remove(selectedIndex);
  change();
}

function test() {
  fetch(document.getElementById(current + "netbox").value + '/api/plugins/docker/hosts/?name=' + document.getElementById(current + "hostname").value, {
    method: 'GET',
    headers: {
        'Accept': 'application/json',
        'Authorization': 'Token ' + document.getElementById(current + "token").value
    }
  })
  .then(response => response.json())
  .then(data => {
      if ('count' in data && data.count == 1)
        alert("Success");
      else alert('Error');
  })
  .catch(error => {
      alert('Error')
  });
}

function save() {
  let update=true;
  let newPaashup="__"+document.getElementById(current + "netbox").value+"__"+document.getElementById(current + "hostname").value;
  let oldPaashup = JSON.parse(localStorage.getItem(newPaashup));
  if (oldPaashup) update=false;
  const data= {
    netbox: document.getElementById(current + "netbox").value,
    token: document.getElementById(current + "token").value,
    hostname: document.getElementById(current + "hostname").value,
    image: document.getElementById(current + "image") ? document.getElementById(current + "image").value : !update ? oldPaashup.image : "",
    oldversion: document.getElementById(current + "oldversion") ? document.getElementById(current + "oldversion").value : !update ? oldPaashup.oldversion : "",
    version: document.getElementById(current + "version") ? document.getElementById(current + "version").value : !update ? oldPaashup.version : "",
    delay: document.getElementById(current + "delay") ? document.getElementById(current + "delay").value : !update ? oldPaashup.delay : "" ,
    instance: document.getElementById(current + "instance") ? document.getElementById(current + "instance").value : !update ? oldPaashup.instance : ""
  }
  localStorage.setItem(newPaashup, JSON.stringify(data));

  if (update) {
    const option=document.createElement("option");
    option.value = newPaashup;
    newPaashup = newPaashup.replace(/^__/g, "");
    option.text=newPaashup;
    select.appendChild(option);
    option.selected = true;
  }
  document.getElementById('notif').innerHTML="Saved";
  document.getElementById('notif').style.backgroundColor='lightgreen';
  change();
}

function rename() {
    const value = prompt("Enter something:", "");
    if(value !== null && select.selectedIndex >= 0 && selected != "") {
        const Paashup = localStorage.getItem(selected);
        localStorage.setItem("__" + value, Paashup);
        localStorage.removeItem(selected);
        for (const option of select.options) {
          if (option.value === selected) {
              option.value = "__" + value;
              option.text = value;
              break;
          }
        }
        selected = value;
    }
}

function change(notif = true) {
  selected=select.value;
  localStorage.setItem("selected", selected);
  const stored = localStorage.getItem(selected);
  if (notif) {
    document.getElementById('notif').innerHTML='<font color="grey">Welcome !</font>';
    document.getElementById('notif').style.backgroundColor='lightblue';
  }
  const data=JSON.parse(stored);
  for (let i of ["c_", "r_", "u_", "d_"]) {
    document.getElementById(i + "netbox") && data ? document.getElementById(i + "netbox").value=data.netbox : document.getElementById(i + "netbox").value = "";
    document.getElementById(i + "token") && data ? document.getElementById(i + "token").value=data.token : document.getElementById(i + "token").value = "";
    document.getElementById(i + "hostname") && data ? document.getElementById(i + "hostname").value=data.hostname : document.getElementById(i + "hostname").value = "";
    document.getElementById(i + "image") && data && 'image' in data ? document.getElementById(i + "image").value=data.image : "";
    document.getElementById(i + "oldversion") && data && 'oldversion' in data ? document.getElementById(i + "oldversion").value=data.oldversion : "";
    document.getElementById(i + "version") && data && 'version' in data ? document.getElementById(i + "version").value=data.version : "";
    document.getElementById(i + "instance") && data && 'instance' in data ? document.getElementById(i + "instance").value=data.instance : "";
    document.getElementById(i + "delay") && data && 'delay' in data ? document.getElementById(i + "delay").value=data.delay : "10000";
  }
}

if (select.selectedIndex >= 0) {
  if (selected != "") {
    for (const option of select.options) {
      if (option.value === selected) {
        option.selected = true;
        break;
      }
    }
  }
  change(false);
}