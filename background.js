const cache = {}

async function createBrowserBookmarkOrFolder(args) {
  const bookmarkOrFolder = await browser.bookmarks.create(args)
  cache[bookmarkOrFolder.id] = bookmarkOrFolder
  return bookmarkOrFolder
}

class PinboardClient {
  constructor(pinboard_access_token) {
    this.pinboard_access_token = pinboard_access_token
  }

  async posts() {
    return getJson(this.apiUrl('posts/all'))
  }

  async renameTag({from, to}) {
    const url = this.apiUrl('tags/rename')
    return getJson(`${url}&old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`)
  }

  apiUrl(action) {
    return `https://api.pinboard.in/v1/${action}?auth_token=${this.pinboard_access_token}&format=json`;
  }
}

async function getAccessToken() {
  return await browser.storage.sync.get("pinboard_access_token")
}

async function getJson(url) {
  const response = await fetch(url)
  return await response.json()
}

async function ensureEmptyPinboardFolder() {
  const bookmarks = await browser.bookmarks.getTree()

  const otherBookmarksFolder = bookmarks[0].children.find(b => b.id === 'unfiled_____')

  const pinboardFolder = otherBookmarksFolder.children.find(b => b.title === 'Pinboard')

  if (pinboardFolder) {
    await Promise.all(
      pinboardFolder.children.map(node => {
        browser.bookmarks.removeTree(node.id)
      })
    )
    return pinboardFolder
  }

  return createBrowserBookmarkOrFolder({
    title: 'Pinboard'
  })
}

const ensureFolder = async (name, parentId) => {
  const bookmarks = await browser.bookmarks.getSubTree(parentId)

  const existingFolder = bookmarks[0].children.find(b => b.title === name && b.type === 'folder')

  if (existingFolder) {
    return existingFolder
  }

  return createBrowserBookmarkOrFolder({
    parentId,
    title: name,
  })
}

(async () => {
  async function updatePinboardBookmarkOrTag(id) {
    const bookmarkOrTag = (await browser.bookmarks.get(id))[0]
    const oldVersion = cache[id]

    if (bookmarkOrTag.type === 'folder' && bookmarkOrTag.title != oldVersion.title) {
      await pinboardClient.renameTag({from: oldVersion.title, to: bookmarkOrTag.title})
    } else {
      console.log('something else');
    }
    cache[id] = bookmarkOrTag
  }

  const {pinboard_access_token} = await getAccessToken()
  const pinboardClient = new PinboardClient(pinboard_access_token)
  const pinboardBookrmarks = await pinboardClient.posts()

  const pinboardFolder = await ensureEmptyPinboardFolder()

  for (const b of pinboardBookrmarks) {
    if (b.tags) {
      await Promise.all(
        b.tags.split(' ').map(async tag => {
          const tagFolder = await ensureFolder(tag, pinboardFolder.id)

          return createBrowserBookmarkOrFolder({
            parentId: tagFolder.id,
            url: b.href,
            title: b.description,
          })
        })
      )
    } else {
      await createBrowserBookmarkOrFolder({
        parentId: pinboardFolder.id,
        url: b.href,
        title: b.description,
      })
    }
  }

  browser.bookmarks.onChanged.addListener(updatePinboardBookmarkOrTag)
})()
