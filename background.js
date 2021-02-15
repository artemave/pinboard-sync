async function getAccessToken() {
  return await browser.storage.sync.get("pinboard_access_token")
}


async function getJson(url) {
  const response = await fetch(url)
  return await response.json()
}

class PinboardClient {
  constructor(pinboard_access_token) {
    this.pinboard_access_token = pinboard_access_token
  }

  async posts(action) {
    return getJson(this.apiUrl(action))
  }

  apiUrl(action) {
    return `https://api.pinboard.in/v1/posts/${action}?auth_token=${this.pinboard_access_token}&format=json`;
  }
}

async function ensurePinboardFolder(bookmarks) {
  const otherBookmarksFolder = bookmarks[0].children.find(b => b.id === 'unfiled_____')

  if (otherBookmarksFolder.children.find(b => b.title === 'Pinboard')) {
    return
  }

  await browser.bookmarks.create({
    title: 'Pinboard'
  })
}

(async () => {
  const {pinboard_access_token} = await getAccessToken()
  const pinboardClient = new PinboardClient(pinboard_access_token)
  const pinboardBookrmarks = await pinboardClient.posts('all')

  const bookmarks = await browser.bookmarks.getTree()
  await ensurePinboardFolder(bookmarks)

  console.log(pinboardBookrmarks)
  console.log(bookmarks)
})()
