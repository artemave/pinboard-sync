# pinboard-sync

Firefox add-on: https://addons.mozilla.org/en-US/firefox/addon/pinboard-sync/

## Description

Manage your Pinboard bookmarks with native browser bookmark tools (sidebar, star button, etc.).

Once configured, there will appear a new folder called "Pinboard" in your "Other bookmarks" folder. Containing your existing pinboard bookmarks. If pinboard bookmark is tagged, it'll be in the corresponding subfolder. If there is more than one tag, there will be that many folders with the same bookmark. This denormalisation is unfortunate, but browser bookmarks API does not support tags, so that's the best I could think of.

A new bookmark placed in the "Pinboard" folder will be automatically synced back to Pinboard. Same is true for deleting and updating an existing one. If a new bookmark is in a subfolder, then the Pinboard bookmark will be tagged accordingly. Similarly, moving bookmarks within subfolders of "Pinboard" folder will update pinboard tags.

At the moment, there is no automatic import of new bookmark from Pinboard. To do this manually, disable and re-enable the add-on.
