// A page wires its own reads. The three count properties are derived from the
// arrays, so they stay correct after a cross-Thing follow/unfollow/like without
// a second write. createPost builds a post object (an id from a counter plus the
// content) — object construction VRE cannot do — so it lives here; follow,
// unfollow and like are generated from the TD's `vre:effects`.

thing.setPropertyReadHandler('posts', async () => state.posts);
thing.setPropertyReadHandler('followers', async () => state.followers);
thing.setPropertyReadHandler('following', async () => state.following);
thing.setPropertyReadHandler('likesReceived', async () => state.likesReceived);
thing.setPropertyReadHandler('likedPosts', async () => state.likedPosts);
thing.setPropertyReadHandler('postCount', async () => state.posts.length);
thing.setPropertyReadHandler('followerCount', async () => state.followers.length);
thing.setPropertyReadHandler('followingCount', async () => state.following.length);

thing.setActionHandler('createPost', async (input) => {
  const { content } = await input.value();
  const id = `post-${state.posts.length + 1}`;
  state.posts = [...state.posts, { id, content }];
  thing.emitPropertyChange('posts');
  thing.emitPropertyChange('postCount');
  return { postId: id, postCount: state.posts.length };
});
