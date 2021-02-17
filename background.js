// if (!window.hasOwnProperty('browser')) {
//   window.browser = window.chrome
// }

const cache = {}

function pick(object, ...props) {
  return props.reduce((result, prop) => {
    result[prop] = object[prop]
    return result
  }, {})
}

class PinboardClient {
  constructor(pinboard_access_token) {
    this.pinboard_access_token = pinboard_access_token
  }

  async posts() {
    return getJson(this.apiUrl('posts/all'))
  }

  async getPost(url) {
    return (await getJson(`${this.apiUrl('posts/get')}&url=${encodeURIComponent(url)}`)).posts[0]
  }

  async addPost(params) {
    let url = this.apiUrl('posts/add')
    for (const param in params) {
      if (params[param]) {
        url += `&${param}=${encodeURIComponent(params[param])}`
      }
    }
    return getJson(url)
  }

  async deletePost(url) {
    return getJson(`${this.apiUrl('posts/delete')}&url=${encodeURIComponent(url)}`)
  }

  async renameTag({from, to}) {
    const url = this.apiUrl('tags/rename')
    return getJson(`${url}&old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`)
  }

  apiUrl(action) {
    return `https://api.pinboard.in/v1/${action}?auth_token=${this.pinboard_access_token}&format=json`;
  }
}

async function createBrowserBookmarkOrFolder(args) {
  const bookmarkOrFolder = await browser.bookmarks.create(args)
  cache[bookmarkOrFolder.id] = bookmarkOrFolder
  return bookmarkOrFolder
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

    // Ignore changes to the root folder
    if (bookmarkOrTag.parentId === 'unfiled_____') {
      return
    }

    if (bookmarkOrTag.type === 'folder') {
      await pinboardClient.renameTag({from: oldVersion.title, to: bookmarkOrTag.title})

    } else if (bookmarkOrTag.title !== oldVersion.title || bookmarkOrTag.url !== oldVersion.url) {
      const pinboardBookrmark = await pinboardClient.getPost(oldVersion.url)
      await pinboardClient.deletePost(oldVersion.url)

      const postParams = Object.assign(
        {
          url: bookmarkOrTag.url,
          description: bookmarkOrTag.title,
          dt: pinboardBookrmark.time,
        },
        pick(pinboardBookrmark, 'tags', 'extended', 'shared', 'toread')
      )

      await pinboardClient.addPost(postParams)
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
