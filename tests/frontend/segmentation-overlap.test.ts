import { expect, test } from "vitest";
import { preferSmallFields } from "../../src/lib/segmentation/prefer-small-fields";
const box = (x:number,y:number,w:number,h:number) => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
test("removes a merged field over two separate smaller fields regardless of proposal order", () => {
  const big=box(0,0,1,1), a=box(.05,.1,.4,.8), b=box(.55,.1,.4,.8);
  expect(preferSmallFields([big,a,b])).toEqual([a,b]);
  expect(preferSmallFields([b,big,a])).toEqual([b,a]);
});
test("retains a legitimate large field and a single nested or duplicate small detection", () => {
  const big=box(0,0,1,1), a=box(.1,.1,.2,.2), duplicate=box(.11,.1,.2,.2);
  expect(preferSmallFields([big,a,duplicate])).toEqual([big,a,duplicate]);
});
test("does not mistake empty space inside a concave bounding box for containment", () => {
  const l=[{x:0,y:0},{x:1,y:0},{x:1,y:.1},{x:.1,y:.1},{x:.1,y:1},{x:0,y:1}];
  const a=box(.2,.2,.2,.2), b=box(.6,.6,.2,.2);
  expect(preferSmallFields([l,a,b])).toEqual([l,a,b]);
});
test("removes intermediate merged regions too, preserving small fields and unrelated regions", () => {
  const big=box(0,0,.8,1), mid=box(0,0,.7,.7), a=box(.05,.05,.2,.2), b=box(.4,.4,.2,.2), other=box(.85,0,.15,1);
  expect(preferSmallFields([big,mid,a,b,other])).toEqual([a,b,other]);
});
