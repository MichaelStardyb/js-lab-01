export class Vector2 {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    add(v: Vector2) { return new Vector2(this.x + v.x, this.y + v.y); }
    sub(v: Vector2) { return new Vector2(this.x - v.x, this.y - v.y); }
    scale(n: number) { return new Vector2(this.x * n, this.y * n); }
    length() { return Math.hypot(this.x, this.y); }
    normalize() { 
        const l = this.length(); 
        return l === 0 ? new Vector2(0,0) : this.scale(1/l); 
    }
    static fromAngle(angle: number) { 
        return new Vector2(Math.cos(angle), Math.sin(angle)); 
    }
    mut_set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }
    mut_add(v: Vector2): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }
    mut_addScaled(v: Vector2, s: number): this {
        this.x += v.x * s;
        this.y += v.y * s;
        return this;
    }
    distanceTo(v: Vector2): number {
        return Math.hypot(this.x - v.x, this.y - v.y);
    }
    distanceSq(v: Vector2): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        return dx * dx + dy * dy;
    }
}
