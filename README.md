# Levenshtein String Set

A word-set that allows retrieval sorted by partial and approximate pattern containment.

Okay, that's a bit too vague :), let's start from the beginning. If you'd like to read about its usage first, then
scroll to the end.


## Levenshtein-distance

The [Levenshtein-distance](https://en.wikipedia.org/wiki/Levenshtein_distance) of two strings `a` and `b` is a metric
that shows how many editing steps (inserting, deleting or replacing a character) is needed to transform `a` into `b`.

So, if we have a list of all the English words, and the user starts typing some input, we could just go and compare
that input against our word list and see which are the ones nearest to it, and suggest them as candidates.

The bad thing about this is that if our word list contains 10000 words, then for each typed character we'd have to
calculate 10k Levenshtein-distances, which is a performance-wise horror, especially that we will need only a few
top-N hits.


## R-trees

[R-trees](https://en.wikipedia.org/wiki/R-tree) to the rescue!

Imagine you're writing a navigation software, you have the coordinates of all petrol stations on the continent, and
the user asks to show the "near" ones, or rather, fetch the petrol stations in the order of an increasing distance from
us, one by one, until we decide to stop (eg. when it would be outside of the displayed map).

The naïve approach would be to calculate the distances of every petrol station, sort them by it, and return the list.
Now you see why it resembles our original problem :).

On the other hand, imagine that we group the petrol stations of the same areas by some dozens and cover them with nice
rectangular tiles. Then we group such tiles by some dozens and cover them with nice huge rectangular tiles again.
And so on, until we collected everything under one enormous top-level tile.

Here comes the key observation of the idea: No content of a tile can be nearer to us than the tile boundary itself.

So, if we have 5000 petrol station in a tile whose nearest point is 400 km from us, then we shouldn't even consider
any of these while we have any candidates nearer than 400 km.

To formulate an algorithm for this we need a neat storage construct: the Priority Queue.

A plain queue works like we can push items one by one to its end and pop items one by one from its start, and the
priority queue is very similar, only it adds a tweak:

Every item in the prio queue has a "priority value" (or "cost", name it whatever you like), and the queue is always
ordered by this value. So when we insert a new (prio value, item) pair, we don't just push it to the end, but find
its place and insert it there (this is a log(N) operation, quite a cheap one). Popping items is the same: pop the
first one.

This guarantees that the items will be popped in the order of priority value.

Back to the petrol stations' problem, now we can sketch up the algorithm.

We will be pushing/popping such tiles into our prio queue, and when pushing, we'll assign the distance (or its square)
from the tile as priority value. (That's cheap to calculate: a tile divides the space into 9 regions of NW, N, NE, W,
inside the tile, E, SW, S, SE, so it's just a few comparisons and arithmetic operations.)

So the algorithm:

- Begin with pushing the top-level tile to the prio queue

Then repeat this:
- Pop an item from the prio queue (this will be the nearest one)
- If it's a petrol station, then it's the nearest one, so return it to the user
- If it's a tile, then enumerate its sub-tiles, and push them (with their distance as prio value) into the queue

This way the end results are generated in the order of increasing distance, and we have to "pay" only for the results
we get, the tiles that contain them, and their immediate siblings.


## R-trees with Levenshtein-distance

First we need something for strings that is like the tiles were for points.

Imagine a string that has sets of possible characters instead of just single characters:

    `{ apple, maple, kettle, beetle } -> [amkb][pae][pte][l][e]`

So we have "tiles" of equal-length strings: I'll call them string sets here.

Can we calculate a minimal L-distance between a string and such a string set? Yes we can.

In the L-distance calculation the value of the character matters only at the substitution cost:
if the new characters are the same, then the "substitution" costs zero, otherwise it costst 1.

This will be modified like if the new character is part of the new character set (i.e. they are
compatible), then the cost is zero, otherwise 1.

Of course such tiles can be contained by higher level tiles too, so it's pretty much the same as the geo-spatial
R-trees were.

How about strings of different lengths?

Let's make the top-level of the tree different: it shall contain sub-trees of length=1 words, length=2 words,
etc.

Basically, that's *almost* all we need.


## Some more features

The concept above would work for recognising the words that *are* similar to the input, but we need the words that
*contain* something similar to it.

So, let's make the cost of inserting to the start and to the end be zero! This way any sub-string match could
(and would) be expanded to a full-string match for free.

But I'd like to consider a shorter match as a better one, so it shouldn't be *exactly* zero, just small enough
so extra padding characters are the fewer the better, but they still don't add up to an extra editing step.


## Future features

Also, in practice the mistake of mis-typing a `c` into a `w` is highly unlikely (so its cost of 1 is justified),
but mis-typing `c` to `s` happens all the time :), so probably it should cost less than 1.

For this, we'd need a cost-matrix, like `cost["c"]["s"] = 0.5` means that if the input is `c` and the word contains
`s`, then this matching step costs only 0.5.

This could also take care of the punctuation characters too, but ... it's a performance hog to call a function and
look up a 2-level mapping for every character match check.

And ... should this matching be case-sensitive or not?

How about accented characters? In German sometimes it seriously affects the meaning ("schon" = "already",
"schön" = "pretty") which we wouldn't like to match, other times it differentiates singular and plural
("Apfel" = "apple", "Äpfel" = "apples") which we'd like to. For this we'd need to differentiate the "discardable"
accents and the "must match" ones.

So we'd actually need not a cost-matrix, but a cost-calculator function. And if we don't want to do case-insensitive
containment check on sets, then perhaps a whole `CharacterSet` class, with its own `add` method that stores the
data in a case-insensitive way. And pass all these along the recursive calls of `static deserialise` and the
recursive constructor calls from within `split()`, so probably it should be a `Context` that contains whatever
we need.

Gonna be funny, but later :).


## Serialisation and deserialisation

Building the tree takes a lot more time than to look things up (this was our deal after all), so this whole
think makes sense only if the word list changes rarely and the lookup code runs at the input device.

For this we need to be able to "export" or "serialise" the tree, store it, send it to the input device, there
we must "import" or "deserialise" it, and ... use it, of course.

The data content of the leaves are the strings, the data content of the upper-level nodes are the lower-level
nodes, so technically it could be a straightforward JSON, like:

```
[
  [   # 1-length subtree
    ...
  ],
  [   # 2-length subtree
    [   # [ap]m
      "am",
      "pm",
    ],
    [   # i[ns]
      "in",
      "is",
    ],
  ], 
  ...
]
```

The serialisation of StringSets into this form would be simple with an appropriate `toJSON()` method, but the other
direction, the deserialisation is problematic, as there is no way to tell `JSON.parse` to create StringSets and not
arrays.

Besides, if we think about data efficiency, this is a bit too verbose, a binary representation would be more concise
and faster to parse. We can use the control characters SI (Shift In, 0x0f) and SO (Shift Out, 0x0e) instead of the
brackets and RS (Record Separator, 0x1e) instead of the commas, and then we don't need to worry about enclosing the
strings in quotes, nor about escaping certain characters in strings. Moreover, the commas between sub-tree
representations are also superfluent, so the binary representation of the structure above is:

```
SI
  SI        # 1-length subtree
    ...
  SO
  SI        # 2-length subtree
    SI
      am RS pm 
    SO
    SI
      in RS is
    SO
  SO
  ...
SO
```

This is about 4x more compact than the human-readable format, and with bigger datasets it can matter.


## Usage:

See `lss_test.js`, but it's quite straightforward:


To train and serialise the model:

```
const { LevenshteinStringSet } = require("./levenshtein_string_set");

const lss = new LevenshteinStringSet();
lss.add_string("alpha");
lss.add_string("beta");
lss.add_string("gamma");

const serialised = lss.serialise();
```

To load and use the model:

```
const serialised = ...;

const lss = new LevenshteinStringSet();
lss.deserialise(serialised);

const resp = lss.lookup("glmta");
for (let i = 0; i < 10; i++) {
    console.log(`  ${i}: ${JSON.stringify(resp.next().value)}`);
}
```
