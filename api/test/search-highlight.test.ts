import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchHighlightParts} from '../../web/src/search-highlight.js';

test('search highlights actual shared characters without changing product text',()=>{
  assert.deepEqual(searchHighlightParts('西冷牛排','牛肉'),[{text:'西冷',matched:false},{text:'牛',matched:true},{text:'排',matched:false}]);
  assert.deepEqual(searchHighlightParts('黑猪五花肉','牛肉'),[{text:'黑猪五花',matched:false},{text:'肉',matched:true}]);
  assert.deepEqual(searchHighlightParts('三文鱼','三文余'),[{text:'三文',matched:true},{text:'鱼',matched:false}]);
  assert.deepEqual(searchHighlightParts('西冷牛排',''),[{text:'西冷牛排',matched:false}]);
});
test('highlighting preserves original glyphs under Unicode and case normalization',()=>{
  assert.deepEqual(searchHighlightParts('🍎苹果 JJ级','苹果 ｊｊ'),[
    {text:'🍎',matched:false},{text:'苹果',matched:true},{text:' ',matched:false},{text:'JJ',matched:true},{text:'级',matched:false}
  ]);
  assert.deepEqual(searchHighlightParts('oﬃce','FFI'),[{text:'o',matched:false},{text:'ﬃ',matched:true},{text:'ce',matched:false}]);
});
test('highlight search terms are literal text including regexp and HTML characters',()=>{
  const text='文字 .* <img> 文字';
  const parts=searchHighlightParts(text,'.* <img>');
  assert.equal(parts.map(part=>part.text).join(''),text);
  assert.deepEqual(parts.filter(part=>part.matched).map(part=>part.text),['.*','<img>']);
});
