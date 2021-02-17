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
    return this.getJson(this.apiUrl('posts/all'))
  }

  async getPost(url) {
    return (await this.getJson(`${this.apiUrl('posts/get')}&url=${encodeURIComponent(url)}`)).posts[0]
  }

  async addPost(params) {
    let url = this.apiUrl('posts/add')
    for (const param in params) {
      if (params[param]) {
        url += `&${param}=${encodeURIComponent(params[param])}`
      }
    }
    return this.getJson(url)
  }

  async deletePost(url) {
    return this.getJson(`${this.apiUrl('posts/delete')}&url=${encodeURIComponent(url)}`)
  }

  async renameTag({from, to}) {
    const url = this.apiUrl('tags/rename')
    return this.getJson(`${url}&old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`)
  }

  apiUrl(action) {
    return `https://api.pinboard.in/v1/${action}?auth_token=${this.pinboard_access_token}&format=json`
  }

  async getJson(url) {
    return this.enqueue(() => getJson(url))
  }

  // Pinboard API is really slow - queue requests to avoid race conditions
  async enqueue(fn) {
    if (this.queue) {
      this.queue = this.queue.finally(() => this.enqueue(fn))
    } else {
      this.queue = fn().finally(() => delete this.queue)
    }
    return this.queue
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

  async function createPinboardBookmark(_id, {title, url}) {
    // Ignore creating folders
    if (!url) return

    await pinboardClient.addPost({
      url,
      description: title,
    })
  }

  async function updateTag(id, {parentId, oldParentId}) {
    const [bookmark] = await browser.bookmarks.get(id)

    const pinboardBookrmark = await pinboardClient.getPost(bookmark.url)

    console.log('pinboardBookrmark', pinboardBookrmark)
    if (!pinboardBookrmark) return

    const [newParentFolder] = await browser.bookmarks.get(parentId)
    const [oldParentFolder] = await browser.bookmarks.get(oldParentId)
    const [newPinboardFolder] = await browser.bookmarks.get(newParentFolder.parentId)
    const [oldPinboardFolder] = await browser.bookmarks.get(oldParentFolder.parentId)

    const isNewFoldarTag = newPinboardFolder?.title === 'Pinboard' ? newParentFolder.title : ''
    const isOldFoldarTag = oldPinboardFolder?.title === 'Pinboard' ? oldParentFolder.title : ''

    const tagToAdd = isNewFoldarTag ? newParentFolder.title : ''
    const tagToRemove = isOldFoldarTag ? oldParentFolder.title : ''

    if (!tagToAdd && !tagToRemove) return

    const updatedTags = pinboardBookrmark.tags.split(' ').filter(t => t && t !== tagToRemove).concat(tagToAdd).join(' ')

    if (updatedTags === pinboardBookrmark.tags) return

    pinboardBookrmark.tags = updatedTags
    pinboardBookrmark.url = pinboardBookrmark.href

    await pinboardClient.deletePost(pinboardBookrmark.url)
    await pinboardClient.addPost(pinboardBookrmark)
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
  // In FF a bookmark is added right after the star button is pressed (before user presses Save button in the popup!)
  // As a result, we need `onMoved` callback to set the tag (in case user chooses folder in the popup)
  browser.bookmarks.onCreated.addListener(createPinboardBookmark)
  browser.bookmarks.onMoved.addListener(updateTag)
})()
