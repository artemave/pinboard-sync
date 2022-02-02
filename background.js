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
    if (!url) {
      consloe.log('getPost', 'skipping empty url')
      return
    }
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
    if (!url) {
      consloe.log('deletePost', 'skipping empty url')
      return
    }
    return this.getJson(`${this.apiUrl('posts/delete')}&url=${encodeURIComponent(url)}`)
  }

  async renameTag({from, to}) {
    if (!from) {
      console.log('renameTag', 'skipping empty from:')
      return
    }
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

async function ensureFirefoxUpdatedNewFolderTitle(folder) {
  return new Promise((resolve, reject) => {
    const i = setInterval(() => {
      browser.bookmarks.get(folder.id).then(([freshFolder]) => {
        console.log('freshFolder.title', freshFolder.title)
        if (freshFolder.title !== 'New Folder') {
          clearInterval(i)
          clearTimeout(t)
          resolve(freshFolder)
        }
      })
    }, 100)

    const t = setTimeout(() => {
      console.log('ensureFirefoxUpdatedNewFolderTitle', 'timed out')
      clearInterval(i)
      resolve(folder)
    }, 20000)
  })
}

async function isInPinboardFolder(id) {
  const [item] = await browser.bookmarks.get(id)

  if (!item.parentId) {
    return false
  }

  const [parent] = await browser.bookmarks.get(item.parentId)

  if (parent.title === 'Pinboard') {
    return true
  }

  return isInPinboardFolder(parent.id)
}

async function createBrowserBookmarkOrFolder({url, title, parentId}) {
  const bookmarkOrFolder = await browser.bookmarks.create({parentId, title, url})
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
  const [parent] = await browser.bookmarks.getSubTree(parentId)

  const existingFolder = parent.children.find(b => b.title === name && b.type === 'folder')

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
    if (!(await isInPinboardFolder(id))) return

    const oldVersion = cache[id]
    if (!oldVersion) return

    const [bookmarkOrTag] = await browser.bookmarks.get(id)
    console.log('updatePinboardBookmarkOrTag', {bookmarkOrTag, oldVersion})

    if (bookmarkOrTag.type === 'folder') {
      await pinboardClient.renameTag({from: oldVersion.title, to: bookmarkOrTag.title})

    } else if (bookmarkOrTag.title !== oldVersion.title || bookmarkOrTag.url !== oldVersion.url) {
      const pinboardBookmark = await pinboardClient.getPost(oldVersion.url)
      const postParams = Object.assign(
        {
          url: bookmarkOrTag.url,
          description: bookmarkOrTag.title,
          dt: pinboardBookmark.time,
        },
        pick(pinboardBookmark, 'tags', 'extended', 'shared', 'toread')
      )

      await pinboardClient.addPost(postParams)

      if (oldVersion.url && bookmarkOrTag.url !== oldVersion.url) {
        await pinboardClient.deletePost(oldVersion.url)
      }
    }
    cache[id] = bookmarkOrTag
  }

  async function updatePinboardBookmarkTags(id, {parentId, oldParentId}) {
    if (!(await isInPinboardFolder(id))) return

    const [bookmark] = await browser.bookmarks.get(id)

    console.log('updateTag', {bookmark, parentId, oldParentId})

    if (!bookmark.url) {
      console.log('Skipping folder')
      return
    }

    let pinboardBookmark = await pinboardClient.getPost(bookmark.url)

    console.log('pinboardBookmark', pinboardBookmark)

    if (!pinboardBookmark) {
      pinboardBookmark = {
        url: bookmark.url,
        description: bookmark.title,
        tags: ''
      }
    } else {
      let [newParentFolder] = await browser.bookmarks.get(parentId)
      const [oldParentFolder] = await browser.bookmarks.get(oldParentId)
      console.log({newParentFolder, oldParentFolder})

      const [newRootFolder] = await browser.bookmarks.get(newParentFolder.parentId)
      const [oldRootFolder] = await browser.bookmarks.get(oldParentFolder.parentId)
      console.log({newRootFolder, oldRootFolder})

      const isNewRootChild = newRootFolder?.title === 'Pinboard'
      const isOldRootChild = oldRootFolder?.title === 'Pinboard'

      // If user creates new folder, then here we see 'New Folder' as opposed to the name
      // user has given it.
      if (newParentFolder.title === 'New Folder') {
        newParentFolder = await ensureFirefoxUpdatedNewFolderTitle(newParentFolder)
      }

      const tagToAdd = isNewRootChild && newParentFolder.title != 'New Folder' ? newParentFolder.title : null
      const tagToRemove = isOldRootChild ? oldParentFolder.title : null

      const updatedTags = pinboardBookmark.tags
        .split(' ')
        .filter(t => t && t !== tagToRemove)
        .concat(tagToAdd)
        .filter(Boolean)
        .join(' ')

      if (updatedTags === pinboardBookmark.tags) return

      pinboardBookmark.tags = updatedTags
      pinboardBookmark.url = pinboardBookmark.href
    }

    await pinboardClient.addPost(pinboardBookmark)
  }

  /*
  "{
    \"id\": \"gzO74eOYa1rJ\",
    \"parentId\": \"toolbar_____\",
    \"index\": 4,
    \"title\": \"BEST METAL & PROG ROCK ALBUMS OF 2021 | METALISED!\",
    \"dateAdded\": 1643660290019,
    \"type\": \"bookmark\",
    \"url\": \"https://metalised.wordpress.com/2022/01/17/best-metal-prog-rock-albums-of-2021/\"
  }"
  */
  async function createPinboardBookmark(id, {title, url, parentId}) {
    // Don't create folders
    if (!url) return

    if (!(await isInPinboardFolder(id))) return

    console.log('createPinboardBookmark', {title, url, parentId})

    const existingPinboardBookmark = await pinboardClient.getPost(url)
    const tags = []
    if (existingPinboardBookmark) {
      tags.concat(existingPinboardBookmark.tags.split(' '))
    }

    const [parentFolder] = await browser.bookmarks.get(parentId)
    const [rootFolder] = await browser.bookmarks.get(parentFolder.parentId)
    const isParentInPinboardFilder = rootFolder?.title === 'Pinboard'
    if (isParentInPinboardFilder) {
      tags.concat(parentFolder.title)
    }

    await pinboardClient.addPost({
      url,
      description: title,
      tags: tags.filter(Boolean).join(' ')
    })
    cache[id] = (await browser.bookmarks.get(id))[0]
  }

  async function removePinboardBookmark(id, {node: {url, parentId}}) {
    const [parent] = await browser.bookmarks.get(parentId)

    if (parent.title !== 'Pinboard' && !(await isInPinboardFolder(parentId))) {
      return
    }

    console.log('removePinboardBookmark', {id, url})
    await pinboardClient.deletePost(url)
    delete cache[id]
  }

  const {pinboard_access_token} = await getAccessToken()
  const pinboardClient = new PinboardClient(pinboard_access_token)
  const pinboardBookmarks = await pinboardClient.posts()
  console.log('pinboardBookmarks', pinboardBookmarks)

  const pinboardFolder = await ensureEmptyPinboardFolder()

  for (const b of pinboardBookmarks) {
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

  // In FF a bookmark is added right after the star button is pressed (before user presses Save button in the popup!)
  // When a user finally presses Save, then, if they chose a folder, an `onMoved` event is fired.
  // At that point, we know both the bookmark and the tag, so we can add it to pinboard.
  browser.bookmarks.onCreated.addListener((...args) => createPinboardBookmark(...args).catch(console.error))
  browser.bookmarks.onMoved.addListener((...args) => updatePinboardBookmarkTags(...args).catch(console.error))
  browser.bookmarks.onChanged.addListener((...args) => updatePinboardBookmarkOrTag(...args).catch(console.error))
  browser.bookmarks.onRemoved.addListener((...args) => removePinboardBookmark(...args).catch(console.error))
})()
