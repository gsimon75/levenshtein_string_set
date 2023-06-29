class PrioQueue {
    _queue = [];

    reset() {
        this._queue = [];
    }

    get is_empty() {
        return this._queue.length === 0;
    }

    push(prio, obj) {
        // find the place for insertion of `obj`: after the end of all the current `prio` items == at the next position
        let start = 0;
        let end = this._queue.length;
        let mid = (start + end) >> 1;
        while ((start + 1) < end) {
            let midvalue = this._queue[mid].prio;
            if (prio === midvalue) {
                break
            }
            if (prio <= midvalue) {
                end = mid;
            }
            if (midvalue <= prio) {
                start = mid + 1;
            }
            mid = (start + end) >> 1;
        }
        while ((mid < this._queue.length) && (this._queue[mid].prio <= prio)) {
            mid++;
        }
        // mid is the position to insert the new item
        this._queue.splice(mid, 0, { prio, obj });
    }

    pop() {
        return this._queue.shift();
    }
}


class StringSetBase {
    // the top level of the L-tree is different, so we need a base class for common things
    constructor(index_xform) {
        this.num_entries = 0; // total entries in the sub-tree of this set
        this.children = [];
        this.index_xform = index_xform || (x => x);
    }


    ldist(a, b) {
        a = this.index_xform(a);
        b = this.index_xform(b);
        // plain Levenshtein-distance
        const alen = a.length;
        const blen = b.length;
        const maxdist = alen + blen;
        // prefix/suffix insertion is almost free: it's worse than without it,
        // but any amount of it still shouldn't cost as much as an edit
        const mincost = 1 / maxdist;

        const d = Array.from({ length: alen + 1 }, () => Array.from({ length: blen + 1 }, () => 0))
        // Meaning: a[0..i] can be transformed into b[0..j] for a cost of d[i][j]

        for (let i = 0; i <= alen; i++) {
            d[i][0] = i;
            // from a[0..i] to get b[0..0] we need i deletions, all of which costs 1
        }
        for (let j = 0; j <= blen; j++) {
            d[0][j] = j * mincost;
            // from a[0..0] to get b[j] we need j insertions, but inserting to the front is almost free
        }

        // now fill the matrix by re-using the already known distances
        for (let i = 1; i <= alen; i++) {
            for (let j = 1; j <= blen; j++) {
                /* "a[0..i) to b[0..j)" can be achieved by:
                - solving "a[0..i-1) to b[0..j-1)" and then replacing a[i-1] with b[j-1]: cost = (a[j-1] === b[j-1]) ? 0 : 1
                - solving "a[0..i) to b[0..j-1)" and then appending b[j-1]: cost = almost free
                - deleting a[i-1] and then solving "a[0..i-1) to b[0..j]": cost = 1 */
                const cost_repl = d[i - 1][j - 1] + ((a[i - 1] === b[j - 1]) ? 0 : 1);
                const cost_ins = d[i][j - 1] + ((i === alen) ? mincost : 1);
                const cost_del = d[i - 1][j] + 1;
                d[i][j] = Math.min(cost_repl, cost_ins, cost_del);
            }
        }
        return d[alen][blen]
    }


    serialise() {
        if (this.is_leaf) {
            // children are strings: SI child0 RS child1 RS ... SO
            return `\x0f${this.children.join("\x1e")}\x0e`;
        }
        // children are StringSets: SI child0 child1 ... SO
        return `\x0f${this.children.filter(c => c).map(c => c.serialise()).join("")}\x0e`;
    }

    toString() {
        if (this.is_leaf) {
            return `(${this.children.join(", ")})`;
        }
        else {
            return "TOP-LEVEL";
        }
    }
}


class StringSet extends StringSetBase {
    // a sequence of character sets that "cover" a number of equal-length strings
    static WIDTH_MAX = 12; // average size of character sets at which we split the set

    constructor(index_xform, length) {
        super(index_xform);
        this.length = length;
        this.charsets = Array.from({ length: length }, () => new Set());
        this._width = null;
    }

    toString() {
        function charset_str(cs) {
            return `[${Array.from(cs).join("")}]`;
        }
        return `(${this.charsets.map(charset_str).join("")})`;
    }

    get is_leaf() {
        // leaf: empty or its children are strings
        return (this.children.length === 0) || !(this.children[0] instanceof StringSet);
    }

    get width() {
        // average size of the character sets
        if (this._width === null) {
            let total = 0;
            this.charsets.forEach(s => { total += s.size; });
            this._width = total / this.charsets.length;
        }
        return this._width;
    }

    add_child(c) {
        // add another StringSet as a child
        if (c.length !== this.length) {
            throw new Error(`Length of '${c}' does not match cover length ${this.length}`);
        }
        // update each character set with the corresponding character sets of c
        for (let i = 0; i < this.length; i++) {
            c.charsets[i].forEach(cc => this.charsets[i].add(cc));
        }
        // update the number of covered entries
        this.num_entries += c.num_entries;
        this.children.push(c);
    }

    add_string(s) {
        // add a string a child
        if (s.length !== this.length) {
            throw new Error(`Length of '${s}' does not match cover length ${this.length}`);
        }
        const ls = this.index_xform(s);
        // update each character set with the corresponding character of s
        for (let i = 0; i < this.length; i++) {
            this.charsets[i].add(ls[i]);
        }

        let changed;
        if (this.is_leaf) {
            changed = (this.children.indexOf(s) < 0);
            if (changed) {
                this.children.push(s);
                this._width = null;
                if (this.width >= this.constructor.WIDTH_MAX) {
                    this.split();
                }
            }
        }
        else {
            // find the child nearest to s and add s to that
            let nearest_child = this.children[0];
            let nearest_child_dist = nearest_child.distance(ls);
            for (let i = 1; i < this.children.length; i++) {
                const child = this.children[i];
                const dist = child.distance(ls);
                if (dist < nearest_child_dist) {
                    nearest_child = child;
                    nearest_child_dist = dist;
                }
            }
            changed = nearest_child.add_string(s);
        }
        if (changed) {
            this.num_entries++;
        }
        return changed;
    }

    add(x) {
        if (x instanceof StringSet) {
            this.add_child(x);
        }
        else {
            this.add_string(x);
        }
    }

    split() {
        // we may assume that this is a leaf node, i.e. its children are the strings
        const n = this.children.length;
        // the pairwise distances of children - we'll need these anyway
        const d = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
        // create 2 StringSets, distribute the children among them, each to the nearest one, in the order of distance from the sets
        const num_ssets = 2;
        // find the two farthest children, they will be the core of the 2 StringSets
        let best = Array(num_ssets);
        best[0] = 0;
        best[1] = 1;
        let biggest_dist = this.ldist(this.children[best[0]], this.children[best[1]]);
        d[best[0]][best[1]] = d[best[1]][best[0]] = biggest_dist;
        for (let i = 0; i < (n - 1); i++) {
            for (let j = i + 1; j < n; j++) {
                const dist = this.ldist(this.children[i], this.children[j]);
                d[i][j] = d[j][i] = dist;
                if (dist > biggest_dist) {
                    best[0] = i;
                    best[1] = j;
                    biggest_dist = dist;
                }
            }
        }
        const ssets = Array.from({ length: num_ssets }, () => new StringSet(this.index_xform, this.length));
        const assigned = new Set();
        for (let i = 0; i < num_ssets; i++) {
            ssets[i].add_string(this.children[best[i]]);
            assigned.add(best[i]);
        }

        // set up the unassigned strings' list
        const unassigned = new Set();
        for (let i = 0; i < n; i++) {
            if (!assigned.has(i)) {
                unassigned.add({
                    idx: i,
                    dist: best.map(j => d[i][j]), // distances from the ssets
                });
            }
        }

        while (unassigned.size) {
            // find the point nearest to one of the sets, and join it
            let smallest_dist = Infinity;
            let nearest = null;
            let target_sset = null;
            unassigned.forEach(r => {
                for (let j = 0; j < num_ssets; j++) {
                    if (
                        (r.dist[j] < smallest_dist) ||
                        (
                            (r.dist[j] === smallest_dist) &&
                            (ssets[j].children.length < ssets[target_sset].children.length)
                        )
                    ) {
                        nearest = r;
                        target_sset = j;
                        smallest_dist = r.dist[j];
                    }
                }
            });
            // assign it to the nearest set
            unassigned.delete(nearest);
            ssets[target_sset].add_string(this.children[nearest.idx]);
            // update the others' distances from a
            unassigned.forEach(r => {
                if (r.dist[target_sset] > d[nearest.idx][r.idx]) {
                    r.dist[target_sset] = d[nearest.idx][r.idx];
                }
            });
        }

        this.children = ssets;
    }


    distance(a) {
        // a modified L-distance: it uses the character sets instead of target string b
        const alen = a.length;
        const maxdist = alen + this.length;
        const mincost = 1 / maxdist;

        const d = Array.from({ length: alen + 1 }, () => Array.from({ length: this.length + 1 }, () => 0));

        for (let i = 0; i <= alen; i++) {
            d[i][0] = i;
        }
        for (let j = 0; j <= this.length; j++) {
            d[0][j] = j * mincost;
        }

        for (let i = 1; i <= alen; i++) {
            for (let j = 1; j <= this.length; j++) {
                const cost_repl = d[i - 1][j - 1] + (this.charsets[j - 1].has(a[i - 1]) ? 0 : 1);
                const cost_ins = d[i][j - 1] + ((i === alen) ? mincost : 1);
                const cost_del = d[i - 1][j] + 1;
                d[i][j] = Math.min(cost_repl, cost_ins, cost_del);
            }
        }
        return d[alen][this.length]
    }

    static deserialise(index_xform, dictree, pos) {
        // must be static, because we know the length only after parsing the 1st child
        // see serialise for the format
        const n = dictree.length;
        if (dictree[pos] !== "\x0f") { // SI
            throw new Error(`Malformed dictree at ${pos}: SI expected`);
        }
        pos++;
        let self = null;
        while (true) {
            if (pos >= n) {
                throw new Error(`Malformed dictree at ${pos}: SO expected`);
            }
            if (dictree[pos] === "\x0e") { // SO
                pos++;
                break;
            }
            let c;
            if (dictree[pos] === "\x0f") { // SI
                // child is a StringSet
                ({ c, pos } = StringSet.deserialise(index_xform, dictree, pos));
            }
            else {
                // child is a string
                let endpos;
                let endchar;
                for (endpos = pos; endpos < n; endpos++) {
                    endchar = dictree[endpos];
                    if ((endchar === "\x0e") || (endchar === "\x1e")) { // SO or RS
                        break;
                    }
                }
                if (endpos >= n) {
                    throw new Error(`Malformed dictree at ${pos}: missing SO or RS`);
                }
                c = dictree.substring(pos, endpos);
                pos = endpos + ((endchar === "\x1e") ? 1 : 0); // skip RS but stay on SO
            }

            if (!self) {
                self = new StringSet(index_xform, c.length);
            }
            self.add(c);
        }
        return { c: self, pos };
    }
}


class LevenshteinStringSet extends StringSetBase {
    // top-level string set: sorts strings in sub-trees according to their length

    get is_leaf() {
        return false;
    }

    deserialise(dictree, pos=0) {
        // we need to pass the replacement cost calculator along the recursive StringSet constructors
        const n = dictree.length;
        if (dictree[pos] !== "\x0f") { // SI
            throw new Error(`Malformed dictree at ${pos}: SI expected`);
        }
        pos++;
        while (true) {
            if (pos >= n) {
                throw new Error(`Malformed dictree at ${pos}: SO expected`);
            }
            if (dictree[pos] === "\x0e") { // SO
                pos++;
                break;
            }
            if (dictree[pos] === "\x0f") { // SI
                let c;
                ({ c, pos } = StringSet.deserialise(this.index_xform, dictree, pos));
                this.children[c.length] = c;
            }
            else {
                throw new Error(`Malformed dictree at ${pos}: SI or SO expected`);
            }
        }
        return pos;
    }

    add_string(s) {
        const length = s.length;
        if (!(length in this.children)) {
            this.children[length] = new StringSet(this.index_xform, length);
        }
        const result = this.children[length].add_string(s);
        if (result) {
            this.num_entries++;
        }
        return result;
    }

    *lookup(s) {
        s = this.index_xform(s);
        const q = new PrioQueue();
        q.push(0, this);
        while (!q.is_empty) {
            const cc = q.pop();
            // console.log(`> Pop; cost=${cc.prio}, item=${cc.obj}`);
            if (cc.obj instanceof StringSetBase) {
                cc.obj.children.forEach(c => {
                    const cost = (c instanceof StringSet) ? c.distance(s) : this.ldist(s, c);
                    // console.log(`>> Push; cost=${cost}, item=${c}`);
                    q.push(cost, c);
                });
            }
            else {
                yield {
                    hint: cc.obj,
                    cost: cc.prio,
                };
            }
        }
    }
}


class CaseInsensitiveLevenshteinStringSet extends LevenshteinStringSet {
    constructor() {
        super(x => x.toLowerCase());
    }
}


module.exports = {
    PrioQueue,
    LevenshteinStringSet,
    CaseInsensitiveLevenshteinStringSet,
};
