# Operations

## Refresh Hosts

The Refresh hosts menu entry uses the selected config, lists Docker hosts from NetBox, and requests a refresh operation for each host one by one. Each host is polled until its operation is back to `none`; `OPERATION_TIMEOUT_SECONDS` controls the timeout and defaults to 30 seconds.

## Recreate

Before recreating containers, the app checks whether the target versioned image exists on each host. If it does not, it creates the versioned image through the normal image API, waits briefly for the agent pull, then continues. It does not call the `force_pull` endpoint.

Upgrade, Operate and Refresh process one item at a time. After each operation request, the app polls the container or host until it is ready before starting the next item. Containers must return to `running` with `operation` set to `none`; hosts must return to `operation` set to `none`. `OPERATION_TIMEOUT_SECONDS` defaults to 30 seconds, and a timeout stops the remaining loop.
