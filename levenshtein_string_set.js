function ldist(a, b) {
    // plain Levenshtein-distance
    const alen = a.length;
    const blen = b.length;
    const maxdist = alen + blen;
    // prefix/suffix insertion is almost free: it's worse than without it,
    // but any amount of it still shouldn't cost as much as an edit
    const mincost = 0.1; //1 / maxdist;

    const d = Array.from({ length: alen + 1 }, _ => Array.from({ length: blen + 1 }, _ => 0))
    // Meaning: a[0..i] can be transformed into b[0..j] for a cost of d[i][j]

    /*
    d.dump = function () {
        console.log("  d=(");
        let s = "         ";
        for (let j = 0; j < blen; j++) {
            s += b[j].padStart(6);
        }
        console.log(s);
        for (let i = 0; i < this.length; i++) {
            const drow = this[i];
            s = `  ${a[i - 1] || " "}`;
            for (let j = 0; j < drow.length; j++) {
                s += drow[j].toFixed(1).padStart(6);
            }
            console.log(s);
        }
        console.log("  )");
    }
    */

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
            const cost_ins = d[i][j - 1] + ((i == alen) ? mincost : 1);
            const cost_del = d[i - 1][j] + 1;
            d[i][j] = Math.min(cost_repl, cost_ins, cost_del);
        }
    }
    //d.dump();
    return d[alen][blen]
}


class PrioQueue {
    // priority queue
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
    constructor() {
        this.num_entries = 0; // total entries in the sub-tree of this set
        this.children = [];
    }

    serialise() {
        if (this.is_leaf) {
            /* We need to recognise object literals when deserialising, and the `JSON` module doesn't support
               "parse an object from the beginning and tell me its end position", so we must be able to tell the end
               from the string, similar to https://en.wikipedia.org/wiki/JSON_streaming#Record_separator-delimited_JSON

               So we add an RS (Record Separator, 0x1e) control character after the JSON object here and look for it
               in deserialise().
             */
            return `[${this.children.filter(c => c).map(c => JSON.stringify(c) + "\x1e").join(",")}]`;
        }
        return `[${this.children.filter(c => c).map(c => c.serialise()).join(",")}]`;
    }

    static skip_whsp(s, pos) {
        const n = s.length;
        while (
            (pos < n) && (
                (s[pos] === " ") || (s[pos] === "\t") || (s[pos] === "\r") || (s[pos] === "\n")
            )
        ) {
            pos++;
        }
        return pos;
    }
}


class StringSet extends StringSetBase {
    // a sequence of character sets that "cover" a number of equal-length strings
    static WIDTH_MAX = 12; // average size of character sets at which we split the set

    constructor(length) {
        super();
        this.length = length;
        this.charsets = Array.from({ length: length }, _ => new Set());
        this._width = null;
    }

    toString() {
        const charsets = this.charsets.map(s => `[${Array.from(s).sort().join("")}]`).join("");
        return `/${charsets}/`;
    }

    dump(indent=0) {
        const istr = "  ".repeat(indent);
        console.log(`${istr}StringSet(length=${this.length}) = ${this}`);
        this.children.forEach(c => {
            if (c instanceof StringSetBase) {
                c.dump(indent + 1);
            }
            else {
                console.log(`${istr}  ${JSON.stringify(c)}`);
            }
        });
    }

    get is_leaf() {
        // leaf: empty or its children are entry objects
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

    add_entry(s) {
        // add a entry object as a child
        if (s.t.length !== this.length) {
            throw new Error(`Length of '${s.t}' does not match cover length ${this.length}`);
        }
        // update each character set with the corresponding character of s.t
        for (let i = 0; i < this.length; i++) {
            this.charsets[i].add(s.t[i]);
        }
        this.num_entries++;

        if (this.is_leaf) {
            this.children.push(s);
            this._width = null;
            if (this.width >= this.constructor.WIDTH_MAX) {
                this.split();
            }
        }
        else {
            // find the child nearest to s.t and add s to that
            let nearest_child = this.children[0];
            let nearest_child_dist = nearest_child.distance(s.t);
            for (let i = 1; i < this.children.length; i++) {
                const child = this.children[i];
                const dist = child.distance(s.t);
                if (dist < nearest_child_dist) {
                    nearest_child = child;
                    nearest_child_dist = dist;
                }
            }
            nearest_child.add_entry(s);
        }
    }

    split() {
        // we may assume that this is a leaf node, i.e. its children are the entry objects
        // console.log("-- SPLITTING FROM:");
        // this.dump();
        const n = this.children.length;
        // the pairwise distances of children - we'll need these anyway
        const d = Array.from({ length: n }, _ => Array.from({ length: n }, _ => 0));
        // create 2 StringSets, distribute the children among them, each to the nearest one, in the order of distance from the sets
        const num_ssets = 2;
        // find the two farthest children, they will be the core of the 2 StringSets
        let best = Array(num_ssets);
        best[0] = 0;
        best[1] = 1;
        let biggest_dist = ldist(this.children[best[0]].t, this.children[best[1]].t);
        d[best[0]][best[1]] = d[best[1]][best[0]] = biggest_dist;
        for (let i = 0; i < (n - 1); i++) {
            for (let j = i + 1; j < n; j++) {
                const dist = ldist(this.children[i].t, this.children[j].t);
                // console.log(`dist: ${dist} / ${this.children[i].t} -> ${this.children[j].t}`);
                d[i][j] = d[j][i] = dist;
                if (dist > biggest_dist) {
                    best[0] = i;
                    best[1] = j;
                    biggest_dist = dist;
                    // console.log("new biggest dist found");
                }
            }
        }
        // console.log(`best=${JSON.stringify(best)}, n=${n}`);
        const ssets = Array.from({ length: num_ssets }, _ => new StringSet(this.length));
        const assigned = new Set();
        for (let i = 0; i < num_ssets; i++) {
            // console.log(`initially adding string "${this.children[best[i]].t}" to cover ${i}`);
            ssets[i].add_entry(this.children[best[i]]);
            assigned.add(best[i]);
        }
        // console.log(`assigned=${JSON.stringify(Array.from(assigned))}`);

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
        // console.log(`unassigned=${JSON.stringify(Array.from(unassigned), null, 2)}`);

        while (unassigned.size) {
            // console.log(`unassigned.size = ${unassigned.size}`)
            // find the point nearest to one of the sets, and join it
            let smallest_dist = Infinity;
            let nearest = null;
            let target_sset = null;
            unassigned.forEach(r => {
                // console.log(`  smallest_dist:=${smallest_dist}, target_sset=${target_sset}`);
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
            // console.log(`nearest: ${JSON.stringify(nearest)}, smallest_dist: ${smallest_dist}`);
            // assign it to the nearest set
            unassigned.delete(nearest);
            // console.log(`adding string "${this.children[nearest.idx].t}" to cover ${target_sset}`);
            ssets[target_sset].add_entry(this.children[nearest.idx]);
            // update the others' distances from a
            unassigned.forEach(r => {
                if (r.dist[target_sset] > d[nearest.idx][r.idx]) {
                    r.dist[target_sset] = d[nearest.idx][r.idx];
                }
            });
        }

        this.children = ssets;
        // console.log(`-- SPLIT ${n} INTO ${this.children[0].children.length} + ${this.children[1].children.length}`);
        // console.log(`-- SPLIT width ${this.width} INTO ${this.children[0].width} + ${this.children[1].width}`);
        // this.dump();
        // console.log("-- SPLIT DONE");
    }


    distance(a) {
        // a modified L-distance: it uses the character sets instead of target string b
        const alen = a.length;
        const maxdist = alen + this.length;
        // prefix/suffix insertion is almost free: it's worse than without it,
        // but any amount of it still shouldn't cost as much as an edit
        const mincost = 1 / maxdist;

        const d = Array.from({ length: alen + 1 }, _ => Array.from({ length: this.length + 1 }, _ => 0));
        // Meaning: a[0..i] can be transformed into b[0..j] for a cost of d[i][j]

        for (let i = 0; i <= alen; i++) {
            d[i][0] = i;
            // from a[0..i] to get b[0..0] we need i deletions, all of which costs 1
        }
        for (let j = 0; j <= this.length; j++) {
            d[0][j] = j * mincost;
            // from a[0..0] to get b[j] we need j insertions, but inserting to the front is almost free
        }

        for (let i = 1; i <= alen; i++) {
            for (let j = 1; j <= this.length; j++) {
                /* "a[0..i) to b[0..j)" can be achieved by:
                - solving "a[0..i-1) to b[0..j-1)" and then replacing a[i-1] with b[j-1]: cost = (a[j-1] === b[j-1]) ? 0 : 1
                - solving "a[0..i) to b[0..j-1)" and then appending b[j-1]: cost = almost free
                - deleting a[i-1] and then solving "a[0..i-1) to b[0..j]": cost = 1 */
                const cost_repl = d[i - 1][j - 1] + (this.charsets[j - 1].has(a[i - 1]) ? 0 : 1);
                const cost_ins = d[i][j - 1] + ((i == alen) ? mincost : 1);
                const cost_del = d[i - 1][j] + 1;
                d[i][j] = Math.min(cost_repl, cost_ins, cost_del);
            }
        }
        return d[alen][this.length]
    }

    static deserialise(dictree, pos) {
        /* First I wanted it to be valid JSON, but `JSON.parse` cannot just parse an object from a string and tell me
        the end position, so I had to add Record Separators. With that it's no longer a valid JSON, so I could've
        chosen a different representation, but it's compact enough, so it stays until there is a reason against it. */
        const n = dictree.length;
        pos = StringSetBase.skip_whsp(dictree, pos);
        if (dictree[pos] !== "[") {
            throw new Error(`Malformed dictree at ${pos}: [ expected`);
        }
        pos++;
        const children = [];
        while (true) {
            pos = StringSetBase.skip_whsp(dictree, pos);
            if (pos >= n) {
                throw new Error(`Malformed dictree at ${pos}: ] expected`);
            }
            if (dictree[pos] === "]") {
                pos++;
                break;
            }
            let c;
            if (dictree[pos] === "[") {
                ({ c, pos } = StringSet.deserialise(dictree, pos));
            }
            else if (dictree[pos] === "{") {
                const endpos = dictree.indexOf("\x1e", pos + 1);
                if (endpos < 0) {
                    throw new Error(`Malformed dictree at ${pos}: missing Record Separator`);
                }
                c = JSON.parse(dictree.substring(pos, endpos));
                pos = endpos + 1;
            }
            else {
                throw new Error(`Malformed dictree at ${pos}: [ or { expected`);
            }
            children.push(c);
            pos = StringSetBase.skip_whsp(dictree, pos);
            if (dictree[pos] === "]") {
                pos++;
                break;
            }
            if (dictree[pos] === ",") {
                pos++;
            }
            else {
                throw new Error(`Malformed dictree at ${pos}: , or ] expected`);
            }
        }
        if (children.length <= 0) {
            throw new Error(`Malformed dictree at ${pos}: empty StringSet`);
        }
        let self;
        if (children[0] instanceof StringSet) {
            self = new StringSet(children[0].length);
            children.forEach(c => { self.add_child(c); });
        }
        else {
            self = new StringSet(children[0].t.length);
            children.forEach(c => { self.add_entry(c); });
        }
        return { c: self, pos };
    }
}


class LevenshteinStringSet extends StringSetBase {
    // top-level string set: sorts strings in sub-trees according to their length

    get is_leaf() {
        return false;
    }

    toString() {
        return "LevenshteinStringSet";
    }

    deserialise(dictree, pos=0) {
        // we need to pass the replacement cost calculator along the recursive StringSet constructors
        const n = dictree.length;
        pos = StringSetBase.skip_whsp(dictree, pos);
        if (dictree[pos] !== "[") {
            throw new Error(`Malformed dictree at ${pos}: [ expected`);
        }
        pos++;
        while (true) {
            pos = StringSetBase.skip_whsp(dictree, pos);
            if (pos >= n) {
                throw new Error(`Malformed dictree at ${pos}: ] expected`);
            }
            if (dictree[pos] === "]") {
                pos++;
                break;
            }
            if (dictree[pos] === "[") {
                let c;
                ({ c, pos } = StringSet.deserialise(dictree, pos));
                this.children[c.length] = c;
                pos = StringSetBase.skip_whsp(dictree, pos);
                if (dictree[pos] === "]") {
                    pos++;
                    break;
                }
                if (dictree[pos] === ",") {
                    pos++;
                }
                else {
                    throw new Error(`Malformed dictree at ${pos}: , or ] expected`);
                }
            }
            else {
                throw new Error(`Malformed dictree at ${pos}: ] or [ expected`);
            }

        }
        return pos;
    }

    add_entry(s) {
        if (s.constructor === String) {
            s = { t: s };
        }
        const length = s.t.length;
        // console.log(`Adding '${s}' (${length})`);
        if (!(length in this.children)) {
            this.children[length] = new StringSet(length);
        }
        this.num_entries++;
        this.children[length].add_entry(s);
    }

    *lookup(s) {
        const q = new PrioQueue();
        q.push(0, this);
        while (!q.is_empty) {
            const cc = q.pop();
            // console.log(`popped: ${cc.constructor} ${cc}`);
            if (cc.obj instanceof StringSetBase) {
                cc.obj.children.forEach(c => {
                    const cost = (c instanceof StringSet) ? c.distance(s) : ldist(s, c.t);
                    // console.log(`pushing: ${cost} / ${c}`);
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

module.exports = {
    PrioQueue,
    LevenshteinStringSet,
};
