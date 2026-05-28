# netbox-docker-image-upgrade
App to deploy new image to all containers

# Run

```
docker run -d -v netbox-docker-image-upgrade:/data -p 1880:1880 --name netbox-docker-image-upgrade saashup/netbox-docker-image-upgrade
```

# Config profiles

The admin UI supports multiple named NetBox configs. In the Config menu, choose or enter a profile name, fill the NetBox URL, token and optional proxy URL, then save. Create, Upgrade, Restart, Delete, host refresh, instance refresh and image refresh all use the selected profile.

# Refresh hosts

The Refresh hosts menu entry uses the selected config, lists Docker hosts from NetBox, and requests a refresh operation for each host one by one. The delay field controls the interval between hosts and defaults to 10000 ms.

# Recreate

Before recreating containers, the Recreate flow checks whether the target versioned image exists on each host. If it does not, the flow creates the versioned image through the normal image API, waits briefly for the agent pull, then continues. It does not call the `force_pull` endpoint.

# Contribute 

```
DATAPATH=. node-red -s settings_dev.js
```
